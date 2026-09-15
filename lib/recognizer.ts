import type { Cup } from "./solver";

export type RasterImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray | number[];
};

export type DetectionType = "normal" | "locked" | "empty";
export type RecognitionIssueSeverity = "info" | "warning" | "error";

export type RecognitionIssue = {
  code: string;
  severity: RecognitionIssueSeverity;
  message: string;
  cupIndex?: number;
  level?: number; // bottom -> top
  colorIndex?: number;
  confidence?: number;
};

export type RecognitionDetection = {
  type: DetectionType;
  fillCount: number;
  box: { x: number; y: number; width: number; height: number };
  confidence: number;
  layerConfidences: number[]; // bottom -> top
  selected: boolean;
};

export type RecognitionResult = {
  cups: Cup[];
  locked: number[];
  palette: string[];
  detections: RecognitionDetection[];
  confidence: number;
  warnings: string[];
  issues: RecognitionIssue[];
  suspiciousCups: number[];
  rows: number;
};

type RGB = [number, number, number];
type HSV = { hue: number; saturation: number; value: number };
type Box = { x0: number; y0: number; x1: number; y1: number; row: number };

type ColorSample = {
  rgb: RGB;
  hsv: HSV;
  cupIndex: number;
  level: number; // bottom -> top
  confidence: number;
};

type RawDetection = {
  type: DetectionType;
  fillCount: number;
  box: Box;
  sampleIndices: number[]; // top -> bottom for occupied slots
  layerConfidences: number[]; // top -> bottom for occupied slots
  confidence: number;
  selected: boolean;
};

type Cluster = { sampleIndices: number[] };

const CAPACITY = 4;
const X_PROBES = [0.34, 0.42, 0.5, 0.58, 0.66];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianRgb(values: RGB[]): RGB {
  return [
    median(values.map((value) => value[0])),
    median(values.map((value) => value[1])),
    median(values.map((value) => value[2])),
  ];
}

function rgbAt(image: RasterImage, x: number, y: number): RGB {
  const px = clamp(Math.round(x), 0, image.width - 1);
  const py = clamp(Math.round(y), 0, image.height - 1);
  const offset = (py * image.width + px) * 4;
  return [image.data[offset] / 255, image.data[offset + 1] / 255, image.data[offset + 2] / 255];
}

function hsv(rgb: RGB): HSV {
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

function circularMean(values: number[]) {
  if (!values.length) return 0;
  let x = 0;
  let y = 0;
  for (const value of values) {
    x += Math.cos((value * Math.PI) / 180);
    y += Math.sin((value * Math.PI) / 180);
  }
  const result = (Math.atan2(y, x) * 180) / Math.PI;
  return result < 0 ? result + 360 : result;
}

function appearanceDistance(a: HSV, b: HSV) {
  return Math.hypot(
    hueDistance(a.hue, b.hue) / 18,
    (a.saturation - b.saturation) / 0.28,
    (a.value - b.value) / 0.3,
  );
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

function detectPuzzleStart(image: RasterImage, value: Float32Array) {
  const rowAverage = new Array(image.height).fill(0);
  for (let y = 0; y < image.height; y++) {
    let sum = 0;
    for (let x = 0; x < image.width; x++) sum += value[y * image.width + x];
    rowAverage[y] = sum / image.width;
  }

  const begin = Math.floor(image.height * 0.18);
  const end = Math.floor(image.height * 0.48);
  let bestY = Math.floor(image.height * 0.27);
  let bestScore = -Infinity;
  for (let y = begin; y < end; y++) {
    const before = median(rowAverage.slice(Math.max(begin, y - 3), y + 1));
    const after = median(rowAverage.slice(y + 1, Math.min(image.height, y + 5)));
    const score = before - after;
    if (before > 0.42 && after < 0.55 && score > bestScore) {
      bestScore = score;
      bestY = y;
    }
  }
  return clamp(bestY + Math.max(3, Math.round(image.height * 0.01)), 0, image.height - 1);
}

function buildChannels(image: RasterImage) {
  const size = image.width * image.height;
  const saturation = new Float32Array(size);
  const value = new Float32Array(size);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = y * image.width + x;
      const color = hsv(rgbAt(image, x, y));
      saturation[index] = color.saturation;
      value[index] = color.value;
    }
  }

  const puzzleStart = detectPuzzleStart(image, value);
  const foreground = new Uint8Array(size);
  for (let y = puzzleStart; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const index = y * image.width + x;
      const s = saturation[index];
      const v = value[index];
      const colorful = s > 0.3 && v > 0.28;
      const brightNeutral = s < 0.18 && v > 0.74;
      const midNeutral = s < 0.12 && v > 0.25 && v < 0.7;
      foreground[index] = colorful || brightNeutral || midNeutral ? 1 : 0;
    }
  }
  return { saturation, value, foreground, puzzleStart };
}

function smooth(values: number[], radius: number) {
  const prefix = new Array(values.length + 1).fill(0);
  for (let index = 0; index < values.length; index++) prefix[index + 1] = prefix[index] + values[index];
  return values.map((_, index) => {
    const from = Math.max(0, index - radius);
    const to = Math.min(values.length - 1, index + radius);
    return (prefix[to + 1] - prefix[from]) / (to - from + 1);
  });
}

function detectRowCenters(image: RasterImage, foreground: Uint8Array, y0: number, y1: number) {
  const rowHeight = y1 - y0 + 1;
  const xCounts = new Array(image.width).fill(0);
  for (let x = 0; x < image.width; x++) {
    let count = 0;
    for (let y = y0; y <= y1; y++) count += foreground[y * image.width + x];
    xCounts[x] = count;
  }

  const radius = Math.max(2, Math.round(image.width * 0.02));
  const scores = smooth(xCounts, radius);
  const minimumScore = rowHeight * 0.32;
  const localRadius = Math.max(3, Math.round(image.width * 0.035));
  const candidates: { x: number; score: number }[] = [];
  for (let x = localRadius; x < image.width - localRadius; x++) {
    if (scores[x] < minimumScore) continue;
    let isMaximum = true;
    for (let probe = x - localRadius; probe <= x + localRadius; probe++) {
      if (scores[probe] > scores[x]) { isMaximum = false; break; }
    }
    if (isMaximum) candidates.push({ x, score: scores[x] });
  }

  const chosen: { x: number; score: number }[] = [];
  const minimumSpacing = image.width * 0.11;
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (chosen.every((item) => Math.abs(item.x - candidate.x) >= minimumSpacing)) chosen.push(candidate);
    if (chosen.length >= 6) break;
  }
  return chosen.sort((a, b) => a.x - b.x).map((item) => item.x);
}

function detectBoxes(image: RasterImage, foreground: Uint8Array, puzzleStart: number) {
  const yCounts = new Array(image.height).fill(0);
  for (let y = puzzleStart; y < image.height; y++) {
    let count = 0;
    const offset = y * image.width;
    for (let x = 0; x < image.width; x++) count += foreground[offset + x];
    yCounts[y] = count;
  }

  const yThreshold = Math.max(6, Math.floor(image.width * 0.12));
  const yActive = yCounts.map((count, y) => y >= puzzleStart && count > yThreshold);
  const yRuns = mergeRuns(getRuns(yActive, 4), Math.max(3, Math.floor(image.height * 0.01)))
    .filter(([y0, y1]) => {
      const height = y1 - y0 + 1;
      return height > image.height * 0.09 && height < image.height * 0.23;
    });

  const boxes: Box[] = [];
  let acceptedRow = 0;
  for (const [y0, y1] of yRuns) {
    const centers = detectRowCenters(image, foreground, y0, y1);
    if (centers.length < 2 || centers.length > 6) continue;
    const gaps = centers.slice(1).map((center, index) => center - centers[index]);
    const spacing = gaps.length ? median(gaps) : image.width * 0.2;
    const cupWidth = clamp(spacing * 0.76, image.width * 0.1, image.width * 0.19);
    for (const center of centers) {
      boxes.push({
        x0: clamp(center - cupWidth / 2, 0, image.width - 1),
        x1: clamp(center + cupWidth / 2, 0, image.width - 1),
        y0,
        y1,
        row: acceptedRow,
      });
    }
    acceptedRow++;
  }

  boxes.sort((a, b) => a.row - b.row || a.x0 - b.x0);
  return { boxes, rows: acceptedRow };
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

function classifyDetection(stats: ReturnType<typeof regionStats>): DetectionType {
  if (stats.colorfulFraction < 0.18 && stats.medianValue > 0.78) return "empty";
  if (stats.colorfulFraction < 0.38 && stats.medianValue < 0.74) return "locked";
  return "normal";
}

function fillCount(image: RasterImage, box: Box, saturation: Float32Array, value: Float32Array) {
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const x0 = Math.floor(box.x0 + width * 0.3);
  const x1 = Math.ceil(box.x1 - width * 0.3);
  const y0 = Math.floor(box.y0 + height * 0.08);
  const y1 = Math.ceil(box.y1 - height * 0.04);
  let start = -1;
  for (let y = y0; y <= y1 - 2; y++) {
    let goodRows = 0;
    for (let offset = 0; offset < 3; offset++) {
      let colored = 0;
      let total = 0;
      for (let x = x0; x <= x1; x++) {
        const index = (y + offset) * image.width + x;
        if (saturation[index] > 0.16 && value[index] > 0.35) colored++;
        total++;
      }
      if (total && colored / total > 0.35) goodRows++;
    }
    if (goodRows === 3) { start = y; break; }
  }
  if (start < 0) return 0;
  const surface = (start - box.y0) / height;
  if (surface < 0.33) return 4;
  if (surface < 0.5) return 3;
  if (surface < 0.67) return 2;
  return 1;
}

function liquidEnd(image: RasterImage, box: Box) {
  const width = box.x1 - box.x0;
  const x0 = Math.floor(box.x0 + width * 0.34);
  const x1 = Math.ceil(box.x1 - width * 0.34);
  for (let y = Math.floor(box.y1); y >= Math.ceil(box.y0); y--) {
    const colors: RGB[] = [];
    for (let x = x0; x <= x1; x++) colors.push(rgbAt(image, x, y));
    const color = hsv(medianRgb(colors));
    if (color.saturation > 0.16 && color.value > 0.45) return y;
  }
  return Math.floor(box.y1 - (box.y1 - box.y0) * 0.08);
}

function logicalLayerCenters(image: RasterImage, box: Box) {
  const height = box.y1 - box.y0;
  const end = liquidEnd(image, box);
  const bottom = end - height * 0.04;
  const third = bottom - height * 0.16;
  const second = third - height * 0.16;
  const top = second - height * 0.22;
  return [top, second, third, bottom]; // top -> bottom
}

function sampleLayer(image: RasterImage, box: Box, y: number) {
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const yRadius = Math.max(1, Math.round(height * 0.025));
  const candidates: { rgb: RGB; hsv: HSV }[] = [];
  for (let py = Math.round(y) - yRadius; py <= Math.round(y) + yRadius; py++) {
    for (const xFraction of X_PROBES) {
      const rgb = rgbAt(image, box.x0 + xFraction * width, py);
      const color = hsv(rgb);
      if (color.saturation > 0.14 && color.value > 0.25) candidates.push({ rgb, hsv: color });
    }
  }

  if (!candidates.length) {
    const rgb = rgbAt(image, (box.x0 + box.x1) / 2, y);
    return { rgb, hsv: hsv(rgb), confidence: 0.25 };
  }

  const groups: { rgb: RGB; hsv: HSV }[][] = [];
  for (const candidate of candidates.slice().sort((a, b) => b.hsv.saturation - a.hsv.saturation)) {
    const group = groups.find((items) => hueDistance(circularMean(items.map((item) => item.hsv.hue)), candidate.hsv.hue) < 18);
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }
  groups.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return median(b.map((item) => item.hsv.saturation)) - median(a.map((item) => item.hsv.saturation));
  });

  const group = groups[0];
  const rgb = medianRgb(group.map((item) => item.rgb));
  const color = hsv(rgb);
  const support = group.length / candidates.length;
  const hueSpread = median(group.map((item) => hueDistance(color.hue, item.hsv.hue)));
  const confidence = clamp(0.35 + support * 0.42 + color.saturation * 0.2 + (1 - clamp(hueSpread / 18, 0, 1)) * 0.12, 0.2, 0.99);
  return { rgb, hsv: color, confidence };
}

function yellowPixel(image: RasterImage, x: number, y: number) {
  const color = hsv(rgbAt(image, x, y));
  return color.hue >= 38 && color.hue <= 70 && color.saturation > 0.55 && color.value > 0.65;
}

function selectedOutline(image: RasterImage, box: Box) {
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const sideWidth = Math.max(2, Math.round(width * 0.1));
  const bottomHeight = Math.max(2, Math.round(height * 0.1));
  let left = 0, leftTotal = 0, right = 0, rightTotal = 0, bottom = 0, bottomTotal = 0;
  for (let y = Math.floor(box.y0 + height * 0.12); y <= Math.ceil(box.y1); y++) {
    for (let dx = 0; dx < sideWidth; dx++) {
      if (yellowPixel(image, box.x0 + dx, y)) left++;
      if (yellowPixel(image, box.x1 - dx, y)) right++;
      leftTotal++; rightTotal++;
    }
  }
  for (let y = Math.floor(box.y1 - bottomHeight); y <= Math.ceil(box.y1); y++) {
    for (let x = Math.floor(box.x0); x <= Math.ceil(box.x1); x++) {
      if (yellowPixel(image, x, y)) bottom++;
      bottomTotal++;
    }
  }
  const scores = [left / Math.max(1, leftTotal), right / Math.max(1, rightTotal), bottom / Math.max(1, bottomTotal)];
  return scores.filter((score) => score > 0.07).length >= 2;
}

function clusterCentroid(cluster: Cluster, samples: ColorSample[]): HSV {
  const items = cluster.sampleIndices.map((index) => samples[index].hsv);
  return {
    hue: circularMean(items.map((item) => item.hue)),
    saturation: items.reduce((sum, item) => sum + item.saturation, 0) / items.length,
    value: items.reduce((sum, item) => sum + item.value, 0) / items.length,
  };
}

function countPenalty(count: number) {
  const remainder = count % CAPACITY;
  return Math.min(remainder, CAPACITY - remainder);
}

function clusterSamples(samples: ColorSample[]) {
  const clusters: Cluster[] = [];
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex++) {
    let bestCluster = -1;
    let bestDistance = Infinity;
    for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex++) {
      const distance = appearanceDistance(samples[sampleIndex].hsv, clusterCentroid(clusters[clusterIndex], samples));
      if (distance < bestDistance) { bestDistance = distance; bestCluster = clusterIndex; }
    }
    if (bestCluster >= 0 && bestDistance <= 1.0) clusters[bestCluster].sampleIndices.push(sampleIndex);
    else clusters.push({ sampleIndices: [sampleIndex] });
  }

  // Repair only small fragments. This uses the game invariant that a real color
  // normally contributes a multiple of four logical layers, without allowing a
  // bad 5+7 merge to collapse visually distinct colors into a 12-layer group.
  while (true) {
    let best: { left: number; right: number; score: number } | null = null;
    for (let left = 0; left < clusters.length; left++) {
      for (let right = left + 1; right < clusters.length; right++) {
        const leftCount = clusters[left].sampleIndices.length;
        const rightCount = clusters[right].sampleIndices.length;
        if (leftCount + rightCount > CAPACITY) continue;
        const gain = countPenalty(leftCount) + countPenalty(rightCount) - countPenalty(leftCount + rightCount);
        if (gain <= 0) continue;
        const distance = appearanceDistance(clusterCentroid(clusters[left], samples), clusterCentroid(clusters[right], samples));
        const score = gain * 4.5 - distance;
        if (score > 0 && (!best || score > best.score)) best = { left, right, score };
      }
    }
    if (!best) break;
    clusters[best.left].sampleIndices.push(...clusters[best.right].sampleIndices);
    clusters.splice(best.right, 1);
  }

  clusters.sort((a, b) => Math.min(...a.sampleIndices) - Math.min(...b.sampleIndices));
  const labels = new Array(samples.length).fill(0);
  clusters.forEach((cluster, clusterIndex) => cluster.sampleIndices.forEach((sampleIndex) => { labels[sampleIndex] = clusterIndex; }));
  const palette = clusters.map((cluster) => {
    const color = medianRgb(cluster.sampleIndices.map((index) => samples[index].rgb));
    const channel = (value: number) => clamp(Math.round(value * 255), 0, 255).toString(16).padStart(2, "0");
    return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
  });
  return { clusters, labels, palette };
}

export function recognizeScreenshot(image: RasterImage): RecognitionResult {
  const issues: RecognitionIssue[] = [];
  const emptyResult = (message: string): RecognitionResult => ({
    cups: [], locked: [], palette: [], detections: [], confidence: 0,
    warnings: [message], issues: [{ code: "no-puzzle", severity: "error", message }], suspiciousCups: [], rows: 0,
  });
  if (image.width < 120 || image.height < 200) return emptyResult("截图尺寸过小");

  const { saturation, value, foreground, puzzleStart } = buildChannels(image);
  const { boxes, rows } = detectBoxes(image, foreground, puzzleStart);
  if (!boxes.length) return emptyResult("没有检测到杯子，请使用完整游戏截图");

  const samples: ColorSample[] = [];
  const rawDetections: RawDetection[] = [];
  const locked: number[] = [];

  boxes.forEach((box, cupIndex) => {
    const stats = regionStats(image, box, saturation, value);
    const type = classifyDetection(stats);
    const selected = selectedOutline(image, box);
    if (type !== "normal") {
      if (type === "locked") locked.push(cupIndex);
      rawDetections.push({ type, fillCount: 0, box, sampleIndices: [], layerConfidences: [], confidence: 0.92, selected });
      return;
    }

    const count = fillCount(image, box, saturation, value);
    const centers = logicalLayerCenters(image, box);
    const firstSlot = CAPACITY - count;
    const sampleIndices: number[] = [];
    const layerConfidences: number[] = [];
    for (let slot = firstSlot; slot < CAPACITY; slot++) {
      const sampled = sampleLayer(image, box, centers[slot]);
      const level = CAPACITY - 1 - slot;
      sampleIndices.push(samples.length);
      layerConfidences.push(sampled.confidence);
      samples.push({ rgb: sampled.rgb, hsv: sampled.hsv, cupIndex, level, confidence: sampled.confidence });
    }
    const confidence = layerConfidences.length ? layerConfidences.reduce((sum, item) => sum + item, 0) / layerConfidences.length : 0.45;
    rawDetections.push({ type, fillCount: count, box, sampleIndices, layerConfidences, confidence, selected });
  });

  const clustered = clusterSamples(samples);
  const cups: Cup[] = rawDetections.map((detection) => detection.sampleIndices.map((index) => clustered.labels[index]).reverse());

  clustered.clusters.forEach((cluster, colorIndex) => {
    const count = cluster.sampleIndices.length;
    if (count % CAPACITY !== 0) {
      const affected = [...new Set(cluster.sampleIndices.map((sampleIndex) => samples[sampleIndex].cupIndex))];
      issues.push({
        code: "color-count",
        severity: "warning",
        colorIndex,
        cupIndex: affected[0],
        message: `颜色 ${colorIndex + 1} 识别为 ${count} 层（涉及杯 ${affected.map((index) => index + 1).join("、")}），不是 ${CAPACITY} 的整数倍`,
      });
    }
  });

  samples.forEach((sample) => {
    if (sample.confidence >= 0.62) return;
    issues.push({
      code: "low-layer-confidence",
      severity: "warning",
      cupIndex: sample.cupIndex,
      level: sample.level,
      confidence: sample.confidence,
      message: `第 ${sample.cupIndex + 1} 杯从杯底数第 ${sample.level + 1} 层置信度 ${Math.round(sample.confidence * 100)}%，建议重点检查`,
    });
  });

  rawDetections.forEach((detection, cupIndex) => {
    if (detection.selected && detection.type === "normal" && detection.confidence < 0.72) {
      issues.push({
        code: "selected-outline",
        severity: "info",
        cupIndex,
        confidence: detection.confidence,
        message: `第 ${cupIndex + 1} 杯检测到黄色选中描边，已自动避开描边采样；建议快速核对该杯`,
      });
    }
  });

  if (rows < 2 || rows > 4) issues.push({ code: "row-layout", severity: "warning", message: `检测到 ${rows} 行杯子，版式可能不是当前支持的游戏皮肤` });
  if (boxes.length < 8) issues.push({ code: "cup-count", severity: "warning", message: `只检测到 ${boxes.length} 个杯子，建议检查截图是否完整` });

  const detections: RecognitionDetection[] = rawDetections.map((detection) => ({
    type: detection.type,
    fillCount: detection.fillCount,
    box: {
      x: detection.box.x0 / image.width,
      y: detection.box.y0 / image.height,
      width: (detection.box.x1 - detection.box.x0) / image.width,
      height: (detection.box.y1 - detection.box.y0) / image.height,
    },
    confidence: detection.confidence,
    layerConfidences: detection.layerConfidences.slice().reverse(),
    selected: detection.selected,
  }));

  const suspiciousCups = [...new Set(issues.flatMap((issue) => issue.cupIndex === undefined ? [] : [issue.cupIndex]))].sort((a, b) => a - b);
  const layerAverage = samples.length ? samples.reduce((sum, sample) => sum + sample.confidence, 0) / samples.length : 0.9;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const confidence = clamp(layerAverage - warningCount * 0.045 - errorCount * 0.15, 0.35, 0.99);
  const warnings = issues.filter((issue) => issue.severity !== "info").map((issue) => issue.message);

  return { cups, locked, palette: clustered.palette, detections, confidence, warnings, issues, suspiciousCups, rows };
}
