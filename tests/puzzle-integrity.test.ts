import { describe, expect, it } from "vitest";
import { assessPuzzleIntegrity, puzzleIntegrityReason } from "../lib/puzzle-integrity";

describe("puzzle integrity safety gate", () => {
  it("accepts a structurally valid water-sort state", () => {
    const report = assessPuzzleIntegrity([
      [0, 1, 0, 1],
      [1, 0, 1, 0],
      [],
      [],
    ]);
    expect(report.safe).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.affectedCups).toEqual([]);
  });

  it("blocks color counts that cannot represent complete water-sort colors and names affected cups", () => {
    const report = assessPuzzleIntegrity([
      [0, 1, 0, 1],
      [1, 0, 1],
      [],
      [],
    ]);
    expect(report.safe).toBe(false);
    const issue = report.issues.find((item) => item.code === "color-count");
    expect(issue?.color).toBe(0);
    expect(issue?.count).toBe(3);
    expect(issue?.cupIndices).toEqual([0, 1]);
    expect(puzzleIntegrityReason(report)).toContain("杯 1、2");
    expect(puzzleIntegrityReason(report)).toContain("停止自动求解");
  });

  it("blocks cups above capacity and invalid locked-cup indices", () => {
    const report = assessPuzzleIntegrity([
      [0, 0, 0, 0, 0],
      [1, 1, 1, 1],
      [],
    ], [9]);
    expect(report.safe).toBe(false);
    expect(report.issues.some((item) => item.code === "over-capacity")).toBe(true);
    expect(report.issues.some((item) => item.code === "invalid-lock")).toBe(true);
  });

  it("allows one visual color to occupy 8 or 12 layers", () => {
    expect(assessPuzzleIntegrity([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [],
      [],
    ]).safe).toBe(true);
    expect(assessPuzzleIntegrity([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [],
      [],
    ]).safe).toBe(true);
  });
});
