import { assessPuzzleIntegrity, puzzleIntegrityReason } from "./puzzle-integrity";
import { solveWithLockedCups, type Cup, type SearchMode, type UnlockSolveResult } from "./solver";

type SolveWorkerRequest = {
  id: number;
  cups: Cup[];
  locked: number[];
  mode: SearchMode;
};

type SolveWorkerResponse = {
  id: number;
  result: UnlockSolveResult;
};

type WorkerScope = {
  onmessage: ((event: MessageEvent<SolveWorkerRequest>) => void) | null;
  postMessage: (message: SolveWorkerResponse) => void;
};

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, cups, locked, mode } = event.data;
  const integrity = assessPuzzleIntegrity(cups, locked, 4);
  if (!integrity.safe) {
    scope.postMessage({
      id,
      result: {
        status: "unsolved",
        moves: [],
        explored: 0,
        elapsedMs: 0,
        reason: puzzleIntegrityReason(integrity),
        unlocked: [],
      },
    });
    return;
  }

  const result = solveWithLockedCups(cups, locked, {
    capacity: 4,
    mode,
    maxUnlocks: locked.length,
    timeoutMs: mode === "fast" ? 5000 : 15000,
  });
  scope.postMessage({ id, result });
};
