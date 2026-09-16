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
11. Android Share Target image POSTs must be intercepted by `public/sw.js` and stored locally; the share handler must not forward the image with `fetch()` or add an application upload endpoint.
12. Shared screenshots are temporary local artifacts. Keep the expiry bounded (currently 30 minutes) and preserve an explicit delete path.
13. The share fast path may auto-recognize and auto-solve, but suspicious recognition must stay visible and the user must be able to open the full editable workflow with the same short-lived screenshot.
14. PWA/offline features must remain progressive enhancement: ordinary upload/paste + solve must continue to work in browsers that do not support installation or Web Share Target.

## Architecture

- `lib/solver.ts`: pure deterministic puzzle/search engine.
- `lib/solver.worker.ts`: browser worker boundary for expensive search.
- `lib/recognizer.ts`: deterministic, local screenshot-to-puzzle pipeline and recognition diagnostics.
- `app/page.tsx`: full editable screenshot/manual workflow and execution guidance.
- `app/share/page.tsx`: installed-PWA fast path for system-shared screenshots.
- `app/pwa-register.tsx`: Service Worker registration, install prompt and handoff from share flow to the full editor.
- `public/manifest.webmanifest`: PWA install metadata and Web Share Target declaration.
- `public/sw.js`: offline caching, local Share Target interception and short-lived shared-image storage.
- `tests/solver.test.ts`: replay/legal-move solver regressions.
- `tests/recognizer.test.ts` + `tests/fixtures/`: real screenshot recognition regressions.
- `tests/pwa.test.ts`: PWA manifest/privacy/share-target contract regressions.

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

## Definition of done for PWA/share changes

- The manifest remains installable and keeps an image `share_target`.
- `/share-target` POST handling remains inside the Service Worker and does not call `fetch()`.
- Shared-image Cache Storage entries expire and can be deleted explicitly.
- `/share` can consume a shared image, recognize it locally, run search in the Worker, and present a first actionable move.
- The same shared image can be handed to the full editor for manual correction before its local cache entry is deleted/expired.
- Offline shell behavior does not break ordinary online navigation or hashed Next.js assets.
- `npm test` and `npm run build` pass.
