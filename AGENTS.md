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
11. Android PWA Share Target image POSTs must be intercepted by `public/sw.js` and stored locally; the share handler must not forward the image with `fetch()` or add an application upload endpoint.
12. Shared screenshots are temporary local artifacts. Keep the expiry bounded (currently 30 minutes) and preserve an explicit delete path.
13. The share fast path may auto-recognize and auto-solve, but suspicious recognition must stay visible and the user must be able to open the full editable workflow with the same short-lived screenshot.
14. PWA/offline features must remain progressive enhancement: ordinary upload/paste + solve must continue to work in browsers that do not support installation or Web Share Target.
15. Continuous-play controls must always expose a mistake rollback. A large “next step” action must never remove the ability to move back one solver step.
16. Screen Wake Lock and haptics are optional progressive enhancements. Failure or lack of platform support must never block recognition, solving, or step execution.
17. Persistent screenshot history is opt-in and local-only. It must stay disabled by default, use browser storage only, have bounded count/age retention, and keep per-item plus clear-all deletion paths.
18. Persisted execution progress and 淘特 skin preferences may use localStorage, but must not include uploaded image bytes or introduce a remote analytics/state service.
19. The Android APK must package the static `out/` bundle locally. Production native runtime must not use `server.url`, Vercel, EdgeOne, or another remote origin to render the app.
20. Native Android screenshot sharing must use `ACTION_SEND image/*`, consume the temporary content URI immediately, copy the image into app-private cache, and feed the existing local recognizer/solver pipeline.
21. The native share receiver must not request broad gallery/storage permissions (`READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE`) just to receive an explicitly shared screenshot.
22. The PWA and APK must keep the same puzzle/recognizer/worker logic; native code should be a thin transport/runtime layer, not a second solver implementation.
23. Native shared-image cache files must be deletable after handoff. The native bridge must not upload or log screenshot bytes remotely.
24. Android build automation must produce an installable APK and run existing web regressions before Gradle packaging.
25. Android self-update must never embed a Gitee/GitHub write credential in the APK. China distribution credentials belong only in GitHub Actions secrets; the installed app may access only public update artifacts.
26. Android update delivery must prefer the public Gitee China mirror when available and automatically fall back to GitHub. Both mirrors must publish the exact same APK bytes, and generated update metadata must include a SHA-256 that is verified before opening the Android installer.

## Architecture

- `lib/solver.ts`: pure deterministic puzzle/search engine.
- `lib/solver.worker.ts`: browser worker boundary for expensive search.
- `lib/recognizer.ts`: deterministic, local screenshot-to-puzzle pipeline and recognition diagnostics.
- `lib/local-history.ts`: optional bounded IndexedDB screenshot history; no network access.
- `app/page.tsx`: full editable screenshot/manual workflow and execution guidance.
- `app/share/page.tsx`: PWA/native fast path and continuous Android execution loop.
- `app/pwa-register.tsx`: Service Worker/PWA registration plus Capacitor native-share handoff into existing file inputs.
- `public/manifest.webmanifest`: PWA install metadata and Web Share Target declaration.
- `public/sw.js`: PWA offline caching, local Share Target interception and short-lived shared-image storage.
- `capacitor.config.ts`: native app id/name and local `out/` bundle configuration.
- `native/android/MainActivity.java`: Capacitor bridge activity and Android intent handoff.
- `native/android/ShareReceiverPlugin.java`: local-only ACTION_SEND image receiver/Capacitor bridge.
- `native/android/NativeUpdaterPlugin.java`: public-manifest update checker, Gitee/GitHub APK failover, checksum verification and Android package-installer handoff.
- `scripts/prepare-android.mjs`: patches the generated Capacitor Android project with the native bridge and manifest intent filter.
- `scripts/generate-update-manifest.mjs`: hashes the built APK and generates identical public update metadata for GitHub/Gitee distribution.
- `.github/workflows/android-apk.yml`: Android SDK/Capacitor/Gradle APK build, GitHub rolling release and optional Gitee public mirror publish.
- `tests/solver.test.ts`: replay/legal-move solver regressions.
- `tests/recognizer.test.ts` + `tests/fixtures/`: real screenshot recognition regressions.
- `tests/pwa.test.ts`: PWA manifest/privacy/share-target contract regressions.
- `tests/mobile-execution.test.ts`: continuous-play, Wake Lock, local history and resume contracts.
- `tests/android-native.test.ts`: Capacitor/offline/native-share/build/update-mirror contract regressions.

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

## Definition of done for continuous mobile execution changes

- The primary mobile step action is reachable one-handed and the user can always roll back one step after a mistaken tap.
- Selecting another screenshot resets the previous solution/worker cleanly and starts a fresh local recognize/solve cycle.
- Wake Lock is released when no solution is active or the feature is disabled.
- Execution step progress is stored locally per puzzle and restored only within valid solution bounds.
- Screenshot history stays opt-in, capped at 8 items, pruned after 7 days, and never performs a network request.
- Existing full-editor and Android Share Target fallbacks remain available.
- `npm test` and `npm run build` pass.

## Definition of done for Android native changes

- `capacitor.config.ts` keeps `webDir: "out"` and does not configure a production `server.url`.
- `MainActivity` registers the local share plugin and forwards both launch and `onNewIntent()` screenshots.
- The generated Android manifest contains `ACTION_SEND`, `image/*`, and singleTask delivery.
- The native plugin copies explicitly shared content into app-private cache and exposes it through Capacitor without broad storage permission.
- The JS bridge sends that file through the same hidden image input used by the quick-solve workflow, then clears the pending native cache entry.
- GitHub Actions runs `npm test`, builds the static web bundle, generates/syncs Capacitor Android, patches native files, and successfully runs Gradle APK assembly.
- Update metadata points only to public artifacts; mirror credentials never enter the bundle or APK.
- A built APK gets one SHA-256 and the exact same file is published to GitHub plus the optional Gitee China mirror.
- Failure of Gitee must not remove the GitHub update fallback or break the offline solver.
- Browser/PWA functionality remains intact after adding native dependencies.
