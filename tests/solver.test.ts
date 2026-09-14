import { describe, expect, it } from "vitest";
import { applyMove, isSolved, solve, solveWithLockedCups, type Cup } from "../lib/solver";

function replay(start: Cup[], moves: { from: number; to: number }[]) {
  let state = start.map((cup) => cup.slice());
  for (const move of moves) {
    const next = applyMove(state, move.from, move.to, 4);
    expect(next).not.toBeNull();
    state = next!.cups;
  }
  return state;
}

describe("solver", () => {
  it("solves a mixed two-color puzzle", () => {
    const puzzle: Cup[] = [[0,1,0,1],[1,0,1,0],[],[]];
    const result = solve(puzzle, { mode: "shortest", timeoutMs: 5000 });
    expect(result.status).toBe("solved");
    if (result.status !== "solved") return;
    expect(isSolved(replay(puzzle, result.moves))).toBe(true);
  });

  it("keeps locked cups unused when a zero-unlock solution exists", () => {
    const puzzle: Cup[] = [[0,1,0,1],[1,0,1,0],[],[],[]];
    const result = solveWithLockedCups(puzzle, [4], { mode: "fast", maxUnlocks: 1 });
    expect(result.status).toBe("solved");
    expect(result.unlocked).toEqual([]);
    expect(result.moves.every((m) => m.from !== 4 && m.to !== 4)).toBe(true);
  });
});
