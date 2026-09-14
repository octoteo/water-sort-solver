# Water Sort Solver

A browser-first solver for the Water Sort / color sorting puzzle shown in the target mobile game.

## v0.1 scope

- Standard 4-layer Water Sort rules.
- A pour moves the full contiguous top run when space allows.
- Manual puzzle editor for arbitrary cup counts.
- Locked/ad cups are excluded by default.
- Solver tries 0 unlocks first, then the minimum number of locked cups.
- Fast best-first mode and A* low-step mode.
- Step-by-step solution playback.
- Static Next.js export: no database, API key, or backend required.

Screenshot recognition is the next milestone. The UI already reserves the upload flow; recognition will remain local-first and editable so a single CV mistake cannot poison the solver state.

## Development

```bash
npm install
npm run dev
```

Tests:

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

A solved non-empty cup contains exactly 4 identical color IDs.

## Search strategy

The solver uses state hashing, cup-permutation canonicalization, symmetry pruning, completed-cup pruning, and an admissible color-run lower bound for A* mode. Locked cups are handled lexicographically: minimize unlocked cups first, then search for a solution.

## Roadmap

1. Screenshot parser for the current game skin.
2. Confidence score + click-to-correct recognition.
3. Regression fixtures from real screenshots (including ad-cup levels).
4. Web Worker search so very hard levels never block the UI.
5. PWA install/offline cache and optional GitHub Pages/Vercel deployment.

## License

MIT (license file will be added before the first public release).
