# Water Sort Solver

A browser-first solver for the Water Sort / color sorting puzzle shown in the target mobile game.

## v0.5

- Standard 4-layer Water Sort rules; a pour moves the full contiguous top run when space allows.
- **Local screenshot recognition for the current 淘特 game skin**: puzzle-area detection, row/grid recovery, liquid layers, empty cups, gray ad/locked cups, and selected-cup outlines.
- Upload, drag-and-drop, Ctrl+V and installed-Android Share Target screenshot input.
- Global puzzle invariants are used as a second validation layer: cup capacity, row geometry, per-color layer multiplicity, and detection confidence.
- **Error localization**: suspicious cups are marked with a red dashed outline; low-confidence layers report the exact cup and bottom-up layer number.
- Human-in-the-loop correction: edit any layer, clear a partial cup, or toggle a locked cup before solving.
- Locked/ad cups are excluded by default; the solver tries 0 unlocks first, then the minimum number of locked cups.
- Fast best-first mode and A* low-step mode.
- **Web Worker solver**: hard searches do not run on the React/UI thread and can be cancelled without losing puzzle state.
- **Animated execution guidance**: source/target highlighting, source-cup tilt, animated pour path, progress, autoplay and speed controls.
- **Installable Android PWA** with offline app-shell caching and image Share Target.
- **Continuous mobile execution mode**: a large bottom action dock, one-tap next step, explicit mistake rollback, and one-tap next-screenshot selection.
- **Screen Wake Lock** during execution when supported; failure/unsupported states degrade gracefully and never block solving.
- **Optional haptics** on step transitions.
- **Progress resume**: the current step is stored locally per recognized puzzle so app switching/reload can resume the same solution.
- **Optional local screenshot history**: disabled by default, stored only in browser IndexedDB, capped at 8 images and automatically pruned after 7 days.
- **Persistent 淘特 profile preferences**: mobile execution preferences and the recognizer skin profile stay on-device in localStorage.
- Next.js + TypeScript; no database, API key, multimodal model, or application backend is required for recognition or solving.

Normal screenshot recognition is performed in the browser with Canvas and deterministic color/geometry analysis. For the installed Android share flow, `/share-target` is intercepted by the PWA Service Worker before the application makes a network request; the image is placed in local Cache Storage with a 30-minute expiry and can be explicitly deleted. There is no application server upload endpoint for shared screenshots.

## Live app

Production deployment: https://water-sort-solver-eight.vercel.app

## Android continuous-play flow

1. Open the production site in Android Chrome and install Water Sort Solver.
2. Take a 淘特 game screenshot.
3. Open Android Share and select **Water Sort Solver**.
4. `/share` recognizes the screenshot locally and starts the Web Worker solver automatically.
5. Use the large bottom **完成第 N 步** button while following the highlighted source/target cups.
6. If you tapped the game incorrectly, use **↶** / **误点了，退一步**.
7. When the solution is finished, tap **下一关截图** and choose the newest screenshot, or share the next screenshot from Android again.
8. Keep-awake, haptics, focus mode, screenshot history and the 淘特 skin profile are remembered locally.

The Share Target depends on browser/OS support for installable web apps and the Web Share Target API. The normal upload / paste workflow remains the fallback.

## Privacy model

- Screenshot pixels are not sent to an AI model.
- Android Share Target image POSTs are intercepted in `public/sw.js` and retained only in local Cache Storage for up to 30 minutes.
- Optional longer screenshot history is **off by default**. If enabled, `lib/local-history.ts` stores at most 8 screenshots in the browser's IndexedDB and removes entries older than 7 days.
- Local history has an explicit per-item delete and clear-all path and never calls `fetch()`.

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

GitHub Actions runs solver, recognizer, PWA/mobile contract regressions and a production Next.js build on every push to `main` and every pull request.

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

The recognizer is intentionally tuned to the game skin used during development. The pipeline is deterministic and local:

1. Detect the game/puzzle boundary so the decorative reward-cup area does not merge into the real puzzle.
2. Recover puzzle rows and regular cup centers from vertical/horizontal projections.
3. Classify normal, empty, and gray locked/ad cups.
4. Estimate partial fill count and sample bottom-anchored logical layers away from cup edges and glossy liquid surfaces.
5. Group sampled colors into solver color IDs.
6. Apply game invariants (4-layer capacity and color-count multiples) to diagnose suspicious recognition.
7. Produce per-cup/per-layer confidence and mark the exact places worth checking before solving.

Automatic recognition is never treated as infallible: the generated state remains editable in the full editor before search.

## Regression gates

- `tests/solver.test.ts`: legal-move replay and solved-state regressions.
- `tests/recognizer.test.ts`: real Android screenshot regression including decorative top cups and a yellow selected-cup outline.
- `tests/pwa.test.ts`: install manifest, Android Share Target, Service Worker privacy and offline-shell contracts.
- `tests/mobile-execution.test.ts`: v0.5 continuous-play, Wake Lock, local history, progress resume and cache-version contracts.

## Search strategy

The solver uses state hashing, cup-permutation canonicalization, symmetry pruning, completed-cup pruning, and an admissible color-run lower bound for A* mode. Locked cups are handled lexicographically: minimize unlocked cups first, then search for a solution. Search runs inside `lib/solver.worker.ts` in the browser so the main UI stays responsive.

## Roadmap

1. ✅ Local screenshot parser for the current game skin.
2. ✅ Confidence score + click-to-correct recognition.
3. ✅ Real screenshot regression fixture + CI regression gate.
4. ✅ Automatic suspicious-cup / low-confidence-layer localization.
5. ✅ Web Worker search and cancellation.
6. ✅ Animated pour guidance.
7. ✅ Android PWA install/offline cache and Share Target.
8. ✅ Continuous mobile loop, Wake Lock, haptics, mistake rollback and progress resume.
9. ✅ Optional local-only screenshot history with bounded retention.
10. Add more real screenshot fixtures as new layouts/visual states are encountered.
11. Improve detection for additional game skins only when real examples are available.

## License

MIT (license file will be added before the first public release).
