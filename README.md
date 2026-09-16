# Water Sort Solver

A browser-first and Android-native solver for the Water Sort / color sorting puzzle shown in the target mobile game.

## v0.6

- Standard 4-layer Water Sort rules; a pour moves the full contiguous top run when space allows.
- **Local screenshot recognition for the current 淘特 game skin**: puzzle-area detection, row/grid recovery, liquid layers, empty cups, gray ad/locked cups, and selected-cup outlines.
- Upload, drag-and-drop, Ctrl+V, Android PWA Share Target, and **native Android ACTION_SEND** screenshot input.
- Global puzzle invariants are used as a second validation layer: cup capacity, row geometry, per-color layer multiplicity, and detection confidence.
- **Error localization**: suspicious cups are marked with a red dashed outline; low-confidence layers report the exact cup and bottom-up layer number.
- Human-in-the-loop correction: edit any layer, clear a partial cup, or toggle a locked cup before solving.
- Locked/ad cups are excluded by default; the solver tries 0 unlocks first, then the minimum number of locked cups.
- Fast best-first mode and A* low-step mode.
- **Web Worker solver**: hard searches do not block the UI and can be cancelled.
- **Continuous mobile execution**: source/target guidance, progress restore, optional wake lock, haptics, local screenshot history, undo, and next-level loop.
- **Installable Android APK via Capacitor 8**. The production web bundle is packaged inside the APK; recognition and solving do not require Vercel, EdgeOne, an API, or an internet connection after installation.
- **Native Android share receiver**: `淘特截图 → 系统分享 → Water Sort Solver → 本地识别 → 本地求解 → 第 1 步`.
- Native shared images are copied into the app cache and handed to the same browser-side recognizer/solver pipeline. No broad photo/storage permission is requested.
- The PWA remains supported as a progressive-enhancement web distribution path.

## Live web app

Production deployment: https://water-sort-solver-eight.vercel.app

The web app remains useful outside China and as a fallback. For China-mainland Android users, the native APK is the preferred distribution path because its runtime does not depend on reaching a foreign web host.

## Android native flow

The native shell uses Capacitor 8 with app id `com.octoteo.watersortsolver` and packages the Next.js static export from `out/`.

```text
淘特
  ↓
截图
  ↓
Android 分享
  ↓
Water Sort Solver APK
  ↓
ACTION_SEND image/*
  ↓
App private cache
  ↓
本地 CV 识别
  ↓
Web Worker 求解
  ↓
逐步执行
```

The APK does **not** need an application backend and does not request `READ_MEDIA_IMAGES` / `READ_EXTERNAL_STORAGE` for the share flow. Android grants temporary access to the shared content URI; the app immediately copies that image into its own private cache.

### Build locally

Capacitor 8 requires Node.js 22+. For Android development, install Android Studio / Android SDK 36.

First native setup:

```bash
npm install
npm run android:init
npm run android:open
```

After web/native changes:

```bash
npm run android:sync
npm run android:open
```

### GitHub Actions APK

`.github/workflows/android-apk.yml` builds an installable debug APK on pushes that affect the Android/web runtime and on manual workflow dispatch. The artifact is named:

```text
water-sort-solver-android-debug
```

This is a **beta/debug distribution build**. The workflow caches the debug signing key to make iterative installs friendlier, but a production release should use a dedicated release keystore stored in GitHub Actions secrets before wide distribution.

## Android PWA flow

The PWA path is still supported:

1. Open the production site in Android Chrome.
2. Install Water Sort Solver.
3. Take a game screenshot.
4. Open Android Share and select **Water Sort Solver**.
5. The PWA opens `/share`, recognizes the screenshot locally, starts the Web Worker solver automatically, and shows the first move.

PWA Share Target screenshots are intercepted by `public/sw.js`, stored in local Cache Storage with a bounded expiry, and can be explicitly deleted. There is no application upload endpoint for shared screenshots.

## Development

```bash
npm install
npm run dev
```

Tests and production web build:

```bash
npm test
npm run build
```

GitHub Actions runs solver, recognizer, PWA, mobile-execution, and Android-native contract regressions on `main` and pull requests.

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

The recognizer remains intentionally tuned to the game skin used during development. The pipeline is deterministic and local:

1. Detect the game/puzzle boundary so decorative reward cups do not merge into the real puzzle.
2. Recover puzzle rows and regular cup centers from vertical/horizontal projections.
3. Classify normal, empty, and gray locked/ad cups.
4. Estimate partial fill count and sample bottom-anchored logical layers away from cup edges and glossy surfaces.
5. Group sampled colors into solver color IDs.
6. Apply game invariants (4-layer capacity and color-count multiples) to diagnose suspicious recognition.
7. Produce per-cup/per-layer confidence and mark the exact places worth checking before solving.

Automatic recognition is never treated as infallible: the generated state remains editable in the full editor before search.

## Real screenshot regression

`tests/recognizer.test.ts` includes a downscaled derivative of a real Android game screenshot containing decorative reward cups above the puzzle and a yellow selected-cup outline. The regression locks the solver-facing facts: row/cup count, gray locked cup, empty cups, and logical colors/layers.

## Privacy contracts

- Web PWA shared screenshots remain local to browser Cache Storage with bounded expiry.
- Optional screenshot history uses browser IndexedDB only and is disabled by default.
- Android native shared screenshots are copied from the temporary share URI into the app's private cache.
- Recognition and solving require no multimodal model, API key, analytics backend, or screenshot upload endpoint.

## Search strategy

The solver uses state hashing, cup-permutation canonicalization, symmetry pruning, completed-cup pruning, and an admissible color-run lower bound for A* mode. Locked cups are handled lexicographically: minimize unlocked cups first, then fewer moves. Search runs inside `lib/solver.worker.ts` so the UI stays responsive in both PWA and APK builds.

## Roadmap

1. ✅ Local screenshot parser for the current game skin.
2. ✅ Confidence score + click-to-correct recognition.
3. ✅ Real screenshot regression fixture + CI regression gate.
4. ✅ Automatic suspicious-cup / low-confidence-layer localization.
5. ✅ Web Worker search and cancellation.
6. ✅ Animated pour guidance.
7. ✅ Android PWA install/offline cache and Share Target.
8. ✅ Continuous mobile execution loop, wake lock, progress restore, optional local history.
9. ✅ Capacitor Android APK with native ACTION_SEND screenshot receiver.
10. Add stable release signing and publish versioned APK releases.
11. Add more real screenshot fixtures as new layouts/visual states are encountered.
12. Improve detection for additional game skins only when real examples are available.

## License

MIT (license file will be added before the first public release).
