# Water Sort Solver

A browser-first solver for the Water Sort / color sorting puzzle shown in the target mobile game.

## v0.3

- Standard 4-layer Water Sort rules; a pour moves the full contiguous top run when space allows.
- **Local screenshot recognition for the current 淘特 game skin**: puzzle-area detection, row/grid recovery, liquid layers, empty cups, gray ad/locked cups, and selected-cup outlines.
- Upload, drag-and-drop, and Ctrl+V screenshot input.
- Global puzzle invariants are used as a second validation layer: cup capacity, row geometry, per-color layer multiplicity, and detection confidence.
- **Error localization**: suspicious cups are marked with a red dashed outline; low-confidence layers report the exact cup and bottom-up layer number.
- Human-in-the-loop correction: edit any layer, clear a partial cup, or toggle a locked cup before solving.
- Keeps the detected screenshot row layout so execution numbers map naturally back to the game.
- Manual puzzle editor for arbitrary cup counts.
- Locked/ad cups are excluded by default; the solver tries 0 unlocks first, then the minimum number of locked cups.
- Fast best-first mode and A* low-step mode.
- **Web Worker solver**: hard searches no longer run on the React/UI thread and can be cancelled without losing the puzzle state.
- **Animated execution guidance**: source/target highlighting, source-cup tilt, animated pour path, progress, autoplay, and speed controls.
- Supports games where the same visual color fills more than one completed cup (color counts may be 4, 8, 12, ... layers).
- Next.js + TypeScript; no database, API key, multimodal model, or backend is required for recognition or solving.

The screenshot pixels are processed in the browser with Canvas and deterministic color/geometry analysis. Images are not sent to an AI model by this application.

## Live app

Production deployment: https://water-sort-solver-eight.vercel.app

## Development

```bash
npm install
npm run dev
```

Tests and production build:

```bash
npm test
npm run build
```

GitHub Actions runs both the solver/recognizer regressions and a production Next.js build on every push to `main` and every pull request.

## State model

Each cup is a `number[]` ordered **bottom -> top**. For example:

```ts
[
  [0, 1, 0, 1],
  [1, 0, 1, 0],
  [],
  [],
]
```

A solved non-empty cup contains exactly 4 identical color IDs. A color ID may legitimately appear in multiple solved cups, so its total layer count only needs to be a multiple of 4.

## Screenshot recognizer

The v0.3 recognizer is intentionally tuned to the game skin used during development. The pipeline is deterministic and local:

1. Detect the game/puzzle boundary so the decorative reward-cup area does not merge into the real puzzle.
2. Recover puzzle rows and regular cup centers from vertical/horizontal projections.
3. Classify normal, empty, and gray locked/ad cups.
4. Estimate partial fill count and sample bottom-anchored logical layers away from cup edges and glossy liquid surfaces.
5. Group sampled colors into solver color IDs.
6. Apply game invariants (4-layer capacity and color-count multiples) to diagnose suspicious recognition.
7. Produce per-cup/per-layer confidence and mark the exact places worth checking before solving.

Automatic recognition is never treated as infallible: the generated state is always editable before search.

## Real screenshot regression

`tests/recognizer.test.ts` includes a downscaled derivative of a real Android game screenshot that contains the two failure modes that originally motivated v0.3: decorative reward cups above the puzzle and a yellow selected-cup outline. The regression locks the solver-facing facts: 3 rows / 12 cups, the gray locked cup, two empty cups, and eight logical colors with valid layer multiplicities.

The fixture is intentionally downscaled because recognition correctness depends on geometry/color relationships rather than retaining a full-resolution mobile screenshot.

## Search strategy

The solver uses state hashing, cup-permutation canonicalization, symmetry pruning, completed-cup pruning, and an admissible color-run lower bound for A* mode. Locked cups are handled lexicographically: minimize unlocked cups first, then search for a solution. Search runs inside `lib/solver.worker.ts` in the browser so the main UI stays responsive.

## Roadmap

1. ✅ Local screenshot parser for the current game skin.
2. ✅ Confidence score + click-to-correct recognition.
3. ✅ Real screenshot regression fixture + CI regression gate.
4. ✅ Automatic suspicious-cup / low-confidence-layer localization.
5. ✅ Web Worker search and cancellation.
6. ✅ Animated pour guidance.
7. Add Android PWA install/offline cache and Share Target (`截图 → 分享 → Solver`).
8. Add more real screenshot fixtures as new layouts/visual states are encountered.
9. Improve detection for additional game skins only when real examples are available.

## License

MIT (license file will be added before the first public release).
