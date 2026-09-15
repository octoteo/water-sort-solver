# Water Sort Solver

A browser-first solver for the Water Sort / color sorting puzzle shown in the target mobile game.

## v0.2

- Standard 4-layer Water Sort rules.
- A pour moves the full contiguous top run when space allows.
- **Local screenshot recognition for the current game skin**: cup rows, liquid layers, empty cups, and gray ad/locked cups.
- Upload, drag-and-drop, and Ctrl+V screenshot input.
- Recognition overlay with cup numbering, confidence, and warnings.
- Human-in-the-loop correction: edit any layer, clear a partial cup, or toggle a locked cup before solving.
- Keeps the detected screenshot row layout so execution numbers map naturally back to the game.
- Manual puzzle editor for arbitrary cup counts.
- Locked/ad cups are excluded by default; the solver tries 0 unlocks first, then the minimum number of locked cups.
- Fast best-first mode and A* low-step mode.
- Visual step execution with source/target highlighting, progress, autoplay, and speed controls.
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

The v0.2 recognizer is intentionally tuned to the game skin used during development. The pipeline is deterministic and local:

1. Detect the puzzle area and cup rows using HSV foreground projections.
2. Detect cup positions from per-row horizontal projections.
3. Classify normal, empty, and gray locked/ad cups.
4. Estimate partial fill count from the liquid surface.
5. Sample stable interior bands rather than the glossy cup edge/surface ellipse.
6. Cluster sampled colors in CIELAB space into solver color IDs.
7. Validate color multiplicities and expose warnings before solving.

Automatic recognition is never treated as infallible: the generated state is always editable before search.

## Search strategy

The solver uses state hashing, cup-permutation canonicalization, symmetry pruning, completed-cup pruning, and an admissible color-run lower bound for A* mode. Locked cups are handled lexicographically: minimize unlocked cups first, then search for a solution.

## Roadmap

1. ✅ Local screenshot parser for the current game skin.
2. ✅ Confidence score + click-to-correct recognition.
3. Add automated image-regression fixtures without publishing private user screenshots.
4. Move hard searches into a Web Worker so the UI never blocks.
5. Add PWA install/offline cache.
6. Improve detection for additional game skins only when real examples are available.

## License

MIT (license file will be added before the first public release).
