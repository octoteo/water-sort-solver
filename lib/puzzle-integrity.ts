import type { Cup } from "./solver";

export type PuzzleIntegrityIssue = {
  code: "empty-puzzle" | "over-capacity" | "invalid-color" | "color-count" | "invalid-lock";
  message: string;
  cupIndices: number[];
  color?: number;
  count?: number;
};

export type PuzzleIntegrityReport = {
  safe: boolean;
  issues: PuzzleIntegrityIssue[];
  affectedCups: number[];
};

function uniqueSorted(values: number[]) {
  return [...new Set(values)].sort((a, b) => a - b);
}

export function assessPuzzleIntegrity(cups: Cup[], locked: number[] = [], capacity = 4): PuzzleIntegrityReport {
  const issues: PuzzleIntegrityIssue[] = [];

  if (!cups.length) {
    issues.push({ code: "empty-puzzle", message: "没有检测到可求解的杯子，请重新截图。", cupIndices: [] });
  }

  cups.forEach((cup, cupIndex) => {
    if (cup.length > capacity) {
      issues.push({
        code: "over-capacity",
        message: `第 ${cupIndex + 1} 杯识别为 ${cup.length} 层，超过杯子容量 ${capacity}，请重新截图或核对该杯。`,
        cupIndices: [cupIndex],
      });
    }
    if (cup.some((color) => !Number.isInteger(color) || color < 0)) {
      issues.push({
        code: "invalid-color",
        message: `第 ${cupIndex + 1} 杯存在无效颜色层，请重新截图或手动修正。`,
        cupIndices: [cupIndex],
      });
    }
  });

  const colorCups = new Map<number, number[]>();
  const colorCounts = new Map<number, number>();
  cups.forEach((cup, cupIndex) => {
    for (const color of cup) {
      if (!Number.isInteger(color) || color < 0) continue;
      colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
      const indices = colorCups.get(color) ?? [];
      if (!indices.includes(cupIndex)) indices.push(cupIndex);
      colorCups.set(color, indices);
    }
  });

  for (const [color, count] of colorCounts) {
    if (count % capacity === 0) continue;
    const cupIndices = colorCups.get(color) ?? [];
    issues.push({
      code: "color-count",
      color,
      count,
      cupIndices,
      message: `颜色 ${color + 1} 共识别到 ${count} 层（杯 ${cupIndices.map((index) => index + 1).join("、")}），不是 ${capacity} 的整数倍。为避免给出错误步骤，已停止自动求解；请优先核对这些杯子。`,
    });
  }

  const invalidLocks = locked.filter((index) => !Number.isInteger(index) || index < 0 || index >= cups.length);
  if (invalidLocks.length) {
    issues.push({
      code: "invalid-lock",
      message: "广告杯位置与识别到的杯子数量不一致，请重新截图。",
      cupIndices: uniqueSorted(invalidLocks.filter((index) => Number.isInteger(index) && index >= 0)),
    });
  }

  const affectedCups = uniqueSorted(issues.flatMap((issue) => issue.cupIndices));
  return { safe: issues.length === 0, issues, affectedCups };
}

export function puzzleIntegrityReason(report: PuzzleIntegrityReport) {
  if (report.safe) return "";
  const first = report.issues[0]?.message ?? "识别结果未通过完整性检查，请重新截图。";
  if (report.issues.length === 1) return first;
  return `${first} 另有 ${report.issues.length - 1} 项完整性异常。`;
}
