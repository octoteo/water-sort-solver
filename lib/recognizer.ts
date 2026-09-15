import type { Cup } from "./solver";

export type RasterImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray | number[];
};

export type DetectionType = "normal" | "locked" | "empty";

export type RecognitionDetection = {
  type: DetectionType;
  fillCount: number;
  box: { x: number; y: number; width: number; height: number };
};

export type RecognitionResult = {
  cups: Cup[];
  locked: number[];
  palette: string[];
  detections: RecognitionDetection[];
  confidence: number;
  warnings: string[];
  rows: number;
};

type RGB = [number, number, number];
type Box = { x0: number; y0: number; x1: number; y1: number; row: number };

type RawDetection = {
  type: DetectionType;
  fillCount: number;
  box: Box;
  sampleIndices: number[];
};

type ColorSample = { rgb: RGB; cupIndex: number };

const CAPACITY = 4;
// The bottom probe intentionally stays above the rounded tip of the glass.
// Selected cups have a yellow outline around that tip; probing too low can
// mistake the outline/highlight for the bottom liquid layer.
const BODY_PROBES = [0.35, 0.55, 0.75, 0.86];
const X_PROBES = [0.30, 0.36, 0.42, 0.50, 0.58, 0.64, 0.70];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rgbAt(image: RasterImage, x: number, y: number): RGB {
  const px = clamp(Math.round(x), 0, image.width - 1);
  const py = clamp(Math.round(y), 0, image.height - 1);
  const offset = (py * image.width + px) * 4;
  return [image.data[offset] / 255, image.data[offset + 1] / 255, image.data[offset + 2] / 255];
}

function hsv(rgb: RGB) {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const saturation = max === 0 ? 0 : delta / max;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { hue, saturation, value: max };
}

function hueDistance(a: number, b: number) {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
}

function patchMedian(image: RasterImage, x: number, y: number, radiusX: number, radiusY: number): RGB {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const x0 = clamp(Math.floor(x - radiusX), 0, image.width - 1);
  const x1 = clamp(Math.ceil(x + radiusX), 0, image.width - 1);
  const y0 = clamp(Math.floor(y - radiusY), 0, image.height - 1);
  const y1 = clamp(Math.ceil(y + radiusY), 0, image.height - 1);
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const [r, g, b] = rgbAt(image, px, py);
      rs.push(r); gs.push(g); bs.push(b);
    }
  }
  return [median(rs), median(gs), median(bs)];
}

function getRuns(active: boolean[], minimumLength: number) {
  const runs: [number, number][] = [];
  let start = -1;
  for (let index = 0; index <= active.length; index++) {
    const on = index < active.length && active[index];
    if (on && start < 0) start = index;
    if (!on && start >= 0) {
      if (index - start >= minimumLength) runs.push([start, index - 1]);
      start = -1;
    }
  }
  return runs;
}

function mergeRuns(runs: [number, number][], maxGap: number) {
  const merged: [number, number][] = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (previous && run[0] - previous[1] <= maxGap) previous[1] = run[1];
    else merged.push([run[0], run[1]]);
  }
  return merged;
}

function buildChannels(image: RasterImage) {
  const size = image.width * image.height;
  const saturation = new Float32Array(size);
  const value = new Float32Array(size);
  const foreground = new Uint8Array(size);
  const startY = Math.floor(image.height * 0.25);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = y * image.width + x;
      const color = hsv(rgbAt(image, x, y));
      saturation[index] = color.saturation;
      value[index] = color.value;
      if (y < startY) continue;
      const colorful = color.saturation > 0.33 && color.value > 0.35;
      const brightNeutral = color.saturation < 0.18 && color.value > 0.72;
      const midNeutral = color.saturation < 0.12 && color.value > 0.28 && color.value < 0.72;
      foreground[index] = colorful || brightNeutral || midNeutral ? 1 : 0;
    }
  }
  return { saturation, value, foreground };
}

function detectBoxes(image: RasterImage, foreground: Uint8Array) {
  const yCounts = new Array(image.height).fill(0);
  for (let y = Math.floor(image.height * 0.25); y < image.height; y++) {
    let count = 0;
    const offset = y * image.width;
    for (let x = 0; x < image.width; x++) count += foreground[offset + x];
    yCounts[y] = count;
  }
  const yThreshold = Math.max(5, Math.floor(image.width * 0.06));
  const yActive = yCounts.map((count) => count > yThreshold);
  // Keep nearby fragments of the same glass row together, but do not merge
  // the decorative reward-cup row above the puzzle with the first puzzle row.
  // On tall Android screenshots the old 2.5% gap could exceed 50 px and merge
  // those two visually separate regions into one giant detection row.
  const yRuns = mergeRuns(getRuns(yActive, 8), Math.max(4, Math.floor(image.height * 0.012)))
    .filter(([y0, y1]) => y1 - y0 + 1 > image.height * 0.11 && y1 - y0 + 1 < image.height * 0.26);

  const boxes: Box[] = [];
  yRuns.forEach(([y0, y1], row) => {
    const rowHeight = y1 - y0 + 1;
    const xCounts = new Array(image.width).fill(0);
    for (let x = 0; x < image.width; x++) {
      let count = 0;
      for (let y = y0; y <= y1; y++) count += foreground[y * image.width + x];
      xCounts[x] = count;
    }
    const xActive = xCounts.map((count) => count > Math.max(3, Math.floor(rowHeight * 0.15)));
    const rawSegments = mergeRuns(getRuns(xActive, 4), Math.max(3, Math.floor(image.width * 0.015)));
    if (!rawSegments.length) return;
    const widths = rawSegments.map(([x0, x1]) => x1 - x0 + 1);
    const typicalWidth = median(widths);
    for (const [x0, x1] of rawSegments) {
      const center = (x0 + x1) / 2;
      boxes.push({
        x0: clamp(center - typicalWidth / 2, 0, image.width - 1),
        x1: clamp(center + typicalWidth / 2, 0, image.width - 1),
        y0,
        y1,
        row,
      });
    }
  });

  boxes.sort((a, b) => a.row - b.row || a.x0 - b.x0);
  return { boxes, rows: yRuns.length };
}

function regionStats(image: RasterImage, box: Box, saturation: Float32Array, value: Float32Array) {
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const x0 = Math.floor(box.x0 + width * 0.22);
  const x1 = Math.ceil(box.x1 - width * 0.22);
  const y0 = Math.floor(box.y0 + height * 0.08);
  const y1 = Math.ceil(box.y1 - height * 0.04);
  let colorful = 0;
  let total = 0;
  const values: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const index = y * image.width + x;
      if (saturation[index] > 0.25) colorful++;
      values.push(value[index]);
      total++;
    }
  }
  return { colorfulFraction: total ? colorful / total : 0, medianValue: median(values) };
}

function fillCount(image: RasterImage, box: Box, saturation: Float32Array) {
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const x0 = Math.floor(box.x0 + width * 0.28);
  const x1 = Math.ceil(box.x1 - width * 0.28);
  const y0 = Math.floor(box.y0 + height * 0.12);
  const y1 = Math.ceil(box.y1 - height * 0.04);
  const rowFractions: number[] = [];
  for (let y = y0; y <= y1; y++) {
    let colored = 0;
    let total = 0;
    for (let x = x0; x <= x1; x++) {
      if (saturation[y * image.width + x] > 0.16) colored++;
      total++;
    }
    rowFractions.push(total ? colored / total : 0);
  }
  let start = -1;
  for (let index = 0; index + 2 < rowFractions.length; index++) {
    if (rowFractions[index] > 0.30 && rowFractions[index + 1] > 0.30 && rowFractions[index + 2] > 0.30) {
      start = index;
      break;
    }
  }
  if (start < 0) return 0;
  const surface = (y0 + start - box.y0) / height;
  if (surface < 0.18) return 4;
  if (surface < 0.40) return 3;
  if (surface < 0.54) return 2;
  return 1;
}

function sampleBodyColor(image: RasterImage, box: Box, yFraction: number): RGB {
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const y = box.y0 + yFraction * height;
  const radiusX = Math.max(1, Math.floor(width * 0.02));
  const radiusY = Math.max(1, Math.floor(height * 0.012));
  const candidates = X_PROBES.map((xFraction) => {
    const rgb = patchMedian(image, box.x0 + xFraction * width, y, radiusX, radiusY);
    return { rgb, ...hsv(rgb) };
  });
  const useful = candidates.filter((candidate) => candidate.saturation > 0.15);
  if (!useful.length) return candidates.sort((a, b) => b.saturation - a.saturation)[0].rgb;

  const groups: typeof useful[] = [];
  const sorted = useful.slice().sort((a, b) => b.saturation - a.saturation);
  for (const candidate of sorted) {
    const group = groups.find((items) => hueDistance(items[0].hue, candidate.hue) < 18);
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }
  groups.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return b.reduce((sum, item) => sum + item.saturation, 0) - a.reduce((sum, item) => sum + item.saturation, 0);
  });
  return groups[0].slice().sort((a, b) => b.saturation - a.saturation)[0].rgb;
}

function srgbToLinear(value: number) {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function rgbToLab(rgb: RGB) {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const pivot = (value: number) => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = pivot(x), fy = pivot(y), fz = pivot(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)] as const;
}

function labDistance(a: readonly number[], b: readonly number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function clusterSamples(samples: ColorSample[]) {
  const labs = samples.map((sample) => rgbToLab(sample.rgb));
  const parent = samples.map((_, index) => index);
  const find = (value: number): number => parent[value] === value ? value : (parent[value] = find(parent[value]));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let a = 0; a < samples.length; a++) {
    for (let b = a + 1; b < samples.length; b++) {
      if (labDistance(labs[a], labs[b]) <= 12) union(a, b);
    }
  }
  const roots = new Map<number, number[]>();
  samples.forEach((_, index) => {
    const root = find(index);
    const list = roots.get(root) ?? [];
    list.push(index);
    roots.set(root, list);
  });
  const clusters = [...roots.values()].sort((a, b) => Math.min(...a) - Math.min(...b));
  const labels = new Array(samples.length).fill(0);
  const palette = clusters.map((indices, clusterIndex) => {
    indices.forEach((index) => { labels[index] = clusterIndex; });
    const rs = indices.map((index) => samples[index].rgb[0]);
    const gs = indices.map((index) => samples[index].rgb[1]);
    const bs = indices.map((index) => samples[index].rgb[2]);
    const channel = (value: number) => clamp(Math.round(value * 255), 0, 255).toString(16).padStart(2, "0");
    return `#${channel(median(rs))}${channel(median(gs))}${channel(median(bs))}`;
  });
  return { labels, palette, clusters };
}

export function recognizeScreenshot(image: RasterImage): RecognitionResult {
  const warnings: string[] = [];
  if (image.width < 120 || image.height < 200) {
    return { cups: [], locked: [], palette: [], detections: [], confidence: 0, warnings: ["截图尺寸过小"], rows: 0 };
  }

  const { saturation, value, foreground } = buildChannels(image);
  const { boxes, rows } = detectBoxes(image, foreground);
  if (!boxes.length) {
    return { cups: [], locked: [], palette: [], detections: [], confidence: 0, warnings: ["没有检测到杯子，请使用完整游戏截图"], rows: 0 };
  }

  const samples: ColorSample[] = [];
  const rawDetections: RawDetection[] = [];
  const locked: number[] = [];

  boxes.forEach((box, cupIndex) => {
    const stats = regionStats(image, box, saturation, value);
    if (stats.colorfulFraction < 0.16) {
      const type: DetectionType = stats.medianValue > 0.78 ? "empty" : "locked";
      if (type === "locked") locked.push(cupIndex);
      rawDetections.push({ type, fillCount: 0, box, sampleIndices: [] });
      return;
    }

    const count = fillCount(image, box, saturation);
    const sampleIndices: number[] = [];
    const probeStart = CAPACITY - count;
    for (let probe = probeStart; probe < CAPACITY; probe++) {
      const rgb = sampleBodyColor(image, box, BODY_PROBES[probe]);
      sampleIndices.push(samples.length);
      samples.push({ rgb, cupIndex });
    }
    rawDetections.push({ type: "normal", fillCount: count, box, sampleIndices });
  });

  if (samples.length % CAPACITY !== 0) warnings.push(`识别到 ${samples.length} 层液体，不是 ${CAPACITY} 的整数倍`);
  const clustered = clusterSamples(samples);
  for (const indices of clustered.clusters) {
    if (indices.length % CAPACITY !== 0) warnings.push(`有一组颜色识别为 ${indices.length} 层，建议人工检查`);
  }

  const cups: Cup[] = rawDetections.map((detection) => detection.sampleIndices.map((index) => clustered.labels[index]).reverse());
  const detections: RecognitionDetection[] = rawDetections.map((detection) => ({
    type: detection.type,
    fillCount: detection.fillCount,
    box: {
      x: detection.box.x0 / image.width,
      y: detection.box.y0 / image.height,
      width: (detection.box.x1 - detection.box.x0) / image.width,
      height: (detection.box.y1 - detection.box.y0) / image.height,
    },
  }));

  if (rows < 2 || rows > 4) warnings.push(`检测到 ${rows} 行杯子，版式可能不是当前支持的游戏皮肤`);
  if (boxes.length < 8) warnings.push(`只检测到 ${boxes.length} 个杯子，建议检查截图是否完整`);
  const confidence = clamp(0.97 - warnings.length * 0.12, warnings.length ? 0.48 : 0.90, 0.98);

  return { cups, locked, palette: clustered.palette, detections, confidence, warnings, rows };
}
