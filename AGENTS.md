# Water Sort Solver - Agent Contract

## Product invariants

1. Core solving must work fully offline and must not require an LLM, API key, database, or backend.
2. A cup is represented bottom-to-top. Default capacity is 4.
3. A legal move pours the largest contiguous top run that fits; it never pours one layer at a time when multiple same-color layers can move together.
4. Destination must be empty or have the same top color.
5. Locked/ad cups are unavailable unless explicitly unlocked by the solver. Optimization order is lexicographic: minimum unlocked cups first, then fewer moves.
6. Screenshot recognition must produce an editable intermediate puzzle state. Recognition is never allowed to bypass user correction.
7. Screenshot recognizer changes must preserve real-fixture regression expectations (cup/row counts, locked and empty cups, logical colors/layers) in addition to synthetic/unit checks.
8. Low-confidence recognition should identify the suspicious cup/layer instead of only emitting a global confidence score.
9. Search correctness beats visual polish. Any solver change needs replay-based regression tests.
10. Browser search must stay off the main UI thread; hard searches belong in the Web Worker and must remain cancellable.

## Architecture

- `lib/solver.ts`: pure deterministic puzzle/search engine.
- `lib/solver.worker.ts`: browser worker boundary for expensive search.
- `lib/recognizer.ts`: deterministic, local screenshot-to-puzzle pipeline and recognition diagnostics.
- `app/`: Next.js UI, screenshot correction, execution guidance, and animation.
- `tests/solver.test.ts`: replay/legal-move solver regressions.
- `tests/recognizer.test.ts` + `tests/fixtures/`: real screenshot recognition regressions.

## Definition of done for solver/search changes

- Generated moves are all legal when replayed from the original state.
- Final state is solved.
- Locked cups are not referenced unless returned in `unlocked`.
- Main-thread UI does not call expensive search directly.
- `npm test` passes.
- `npm run build` passes.

## Definition of done for recognizer changes

- Existing real screenshot fixtures keep passing unless the expected puzzle state was proven wrong.
- New visual failure modes should be converted into a regression fixture or an equivalent deterministic raster test.
- Recognition anomalies identify the cup and, where possible, the exact bottom-up layer.
- User correction remains available before search.
- `npm test` and `npm run build` pass.
