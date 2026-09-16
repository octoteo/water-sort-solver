import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const capacitorConfig = readFileSync(new URL("../capacitor.config.ts", import.meta.url), "utf8");
const mainActivity = readFileSync(new URL("../native/android/MainActivity.java", import.meta.url), "utf8");
const sharePlugin = readFileSync(new URL("../native/android/ShareReceiverPlugin.java", import.meta.url), "utf8");
const capturePlugin = readFileSync(new URL("../native/android/ScreenCapturePlugin.java", import.meta.url), "utf8");
const captureService = readFileSync(new URL("../native/android/ScreenCaptureService.java", import.meta.url), "utf8");
const updaterPlugin = readFileSync(new URL("../native/android/NativeUpdaterPlugin.java", import.meta.url), "utf8");
const installReceiver = readFileSync(new URL("../native/android/NativeInstallReceiver.java", import.meta.url), "utf8");
const prepareScript = readFileSync(new URL("../scripts/prepare-android.mjs", import.meta.url), "utf8");
const generateManifestScript = readFileSync(new URL("../scripts/generate-update-manifest.mjs", import.meta.url), "utf8");
const publishGiteeScript = readFileSync(new URL("../scripts/publish-gitee-release.mjs", import.meta.url), "utf8");
const pwaRegister = readFileSync(new URL("../app/pwa-register.tsx", import.meta.url), "utf8");
const solverWorker = readFileSync(new URL("../lib/solver.worker.ts", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/android-apk.yml", import.meta.url), "utf8");
const updateManifest = JSON.parse(readFileSync(new URL("../public/update/latest.json", import.meta.url), "utf8"));

describe("v0.9.2 Android native contract", () => {
  it("bundles the static app into Capacitor 8 without a runtime server", () => {
    expect(packageJson.version).toBe("0.9.2");
    expect(packageJson.androidVersionCode).toBe(13);
    expect(packageJson.dependencies["@capacitor/core"]).toBe("8.5.2");
    expect(packageJson.dependencies["@capacitor/android"]).toBe("8.5.2");
    expect(capacitorConfig).toContain('appId: "com.octoteo.watersortsolver"');
    expect(capacitorConfig).toContain('webDir: "out"');
    expect(capacitorConfig).not.toContain("server.url");
  });

  it("receives Android ACTION_SEND images without broad storage permission", () => {
    expect(mainActivity).toContain("registerPlugin(ShareReceiverPlugin.class)");
    expect(sharePlugin).toContain("Intent.ACTION_SEND");
    expect(sharePlugin).toContain("getCacheDir()");
    expect(sharePlugin).not.toContain("READ_MEDIA_IMAGES");
    expect(sharePlugin).not.toContain("READ_EXTERNAL_STORAGE");
  });

  it("keeps one user-authorized MediaProjection session for repeated split-screen captures", () => {
    expect(mainActivity).toContain("registerPlugin(ScreenCapturePlugin.class)");
    expect(capturePlugin).toContain("startCaptureSession");
    expect(capturePlugin).toContain("getCaptureSessionStatus");
    expect(capturePlugin).toContain("captureOtherPane");
    expect(capturePlugin).toContain("stopCaptureSession");
    expect(capturePlugin).toContain("captureSessionChanged");
    expect(captureService).toContain("ACTION_START_SESSION");
    expect(captureService).toContain("requestCapture");
    expect(captureService).toContain("isSessionActive");
    expect(captureService).toContain("WaterSortContinuousCapture");
    expect(captureService).toContain("FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION");
    expect(captureService).toContain("computeOtherPane");
    expect(captureService).toContain("Bitmap.createBitmap(full, crop.left, crop.top");
    expect(prepareScript).toContain("android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION");
    expect(prepareScript).toContain('android:foregroundServiceType="mediaProjection"');
  });

  it("offers one-tap entry and repeated capture controls in the native UI", () => {
    expect(pwaRegister).toContain("▶ 开始分屏求解");
    expect(pwaRegister).toContain("📸 连续截图");
    expect(pwaRegister).toContain("结束");
    expect(pwaRegister).toContain("startCaptureSession");
    expect(pwaRegister).toContain("getCaptureSessionStatus");
    expect(pwaRegister).toContain("autocapture=1");
    expect(pwaRegister).toContain("dispatchImageFile");
  });

  it("blocks structurally unsafe recognized states before the search begins", () => {
    expect(solverWorker).toContain('from "./puzzle-integrity"');
    expect(solverWorker).toContain("assessPuzzleIntegrity(cups, locked, 4)");
    expect(solverWorker).toContain("puzzleIntegrityReason(integrity)");
    expect(solverWorker.indexOf("assessPuzzleIntegrity")).toBeLessThan(solverWorker.indexOf("solveWithLockedCups(cups"));
  });

  it("installs updates through PackageInstaller instead of exposing FileProvider to MIUI", () => {
    expect(mainActivity).toContain("registerPlugin(NativeUpdaterPlugin.class)");
    expect(updaterPlugin).toContain("PackageInstaller.SessionParams");
    expect(updaterPlugin).toContain('session.openWrite("base.apk"');
    expect(updaterPlugin).toContain("session.commit(statusReceiver)");
    expect(updaterPlugin).toContain("PendingIntent.FLAG_MUTABLE");
    expect(updaterPlugin).not.toContain("FileProvider");
    expect(updaterPlugin).not.toContain("Intent.ACTION_INSTALL_PACKAGE");
    expect(installReceiver).toContain("PackageInstaller.STATUS_PENDING_USER_ACTION");
    expect(installReceiver).toContain("Intent.EXTRA_INTENT");
    expect(prepareScript).toContain('android:name=".NativeInstallReceiver"');
    expect(prepareScript).not.toContain("water_sort_file_paths");
    expect(prepareScript).not.toContain("androidx.core.content.FileProvider");
    expect(updaterPlugin).toContain('MessageDigest.getInstance("SHA-256")');
  });

  it("keeps the China-first update mirror", () => {
    expect(updateManifest.versionCode).toBe(13);
    expect(updateManifest.versionName).toBe("0.9.2");
    expect(updateManifest.apkSources[0].url).toBe("https://gitee.com/octoteo/water-sort-solver-android/releases/download/v0.9.2/Water-Sort-Solver.apk");
    expect(updateManifest.apkSources[1].url).toBe("https://github.com/octoteo/water-sort-solver/releases/download/android-latest/Water-Sort-Solver.apk");
    expect(generateManifestScript).toContain("releases/download/v${versionName}/Water-Sort-Solver.apk");
  });

  it("builds one APK and publishes the same bytes to GitHub and Gitee", () => {
    expect(workflow).toContain("npx cap add android");
    expect(workflow).toContain("./gradlew assembleDebug");
    expect(workflow).toContain("generate-update-manifest.mjs");
    expect(workflow).toContain("Water-Sort-Solver.apk");
    expect(workflow).toContain("GITEE_TOKEN");
    expect(workflow).toContain("publish-gitee-release.mjs");
    expect(workflow).toContain("Verify public Gitee update mirror");
    expect(publishGiteeScript).toContain("attach_files");
  });
});
