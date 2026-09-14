# Water Sort Solver - Agent Contract

## Product invariants

1. Core solving must work fully offline and must not require an LLM, API key, database, or backend.
2. A cup is represented bottom-to-top. Default capacity is 4.
3. A legal move pours the largest contiguous top run that fits; it never pours one layer at a time when multiple same-color layers can move together.
4. Destination must be empty or have the same top color.
5. Locked/ad cups are unavailable unless explicitly unlocked by the solver. Optimization order is lexicographic: minimum unlocked cups first, then fewer moves.
6. Screenshot recognition must produce an editable intermediate puzzle state. Recognition is never allowed to bypass user correction.
7. Search correctness beats visual polish. Any solver change needs replay-based regression tests.

## Architecture

- `lib/solver.ts`: pure deterministic puzzle/search engine.
- `app/`: Next.js UI and future screenshot pipeline.
- `tests/`: regression tests that replay every generated move and verify the final solved state.

## Definition of done for solver changes

- Generated moves are all legal when replayed from the original state.
- Final state is solved.
- Locked cups are not referenced unless returned in `unlocked`.
- `npm test` passes.
- `npm run build` passes.
