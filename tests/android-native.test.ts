import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const capacitorConfig = readFileSync(new URL("../capacitor.config.ts", import.meta.url), "utf8");
const mainActivity = readFileSync(new URL("../native/android/MainActivity.java", import.meta.url), "utf8");
const sharePlugin = readFileSync(new URL("../native/android/ShareReceiverPlugin.java", import.meta.url), "utf8");
const capturePlugin = readFileSync(new URL("../native/android/ScreenCapturePlugin.java", import.meta.url), "utf8");
const captureService = readFileSync(new URL("../native/android/ScreenCaptureService.java", import.meta.url), "utf8");
const updaterPlugin = readFileSync(new URL("../native/android/NativeUpdaterPlugin.java", import.meta.url), "utf8");
const prepareScript = readFileSync(new URL("../scripts/prepare-android.mjs", import.meta.url), "utf8");
const generateManifestScript = readFileSync(new URL("../scripts/generate-update-manifest.mjs", import.meta.url), "utf8");
const publishGiteeScript = readFileSync(new URL("../scripts/publish-gitee-release.mjs", import.meta.url), "utf8");
const pwaRegister = readFileSync(new URL("../app/pwa-register.tsx", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/android-apk.yml", import.meta.url), "utf8");
const updateManifest = JSON.parse(readFileSync(new URL("../public/update/latest.json", import.meta.url), "utf8"));

describe("v0.8 Android native contract", () => {
  it("bundles the static app into Capacitor 8 without a runtime server", () => {
    expect(packageJson.version).toBe("0.8.0");
    expect(packageJson.androidVersionCode).toBe(8);
    expect(packageJson.dependencies["@capacitor/core"]).toBe("8.5.2");
    expect(packageJson.dependencies["@capacitor/android"]).toBe("8.5.2");
    expect(packageJson.devDependencies["@capacitor/cli"]).toBe("8.5.2");
    expect(capacitorConfig).toContain('appId: "com.octoteo.watersortsolver"');
    expect(capacitorConfig).toContain('webDir: "out"');
    expect(capacitorConfig).not.toContain("server.url");
    expect(prepareScript).toContain("packageJson.androidVersionCode");
    expect(prepareScript).toContain("packageJson.version");
  });

  it("receives Android ACTION_SEND images without broad storage permission", () => {
    expect(mainActivity).toContain("registerPlugin(ShareReceiverPlugin.class)");
    expect(mainActivity).toContain("onNewIntent");
    expect(sharePlugin).toContain("Intent.ACTION_SEND");
    expect(sharePlugin).toContain("Intent.EXTRA_STREAM");
    expect(sharePlugin).toContain("getCacheDir()");
    expect(sharePlugin).not.toContain("READ_MEDIA_IMAGES");
    expect(sharePlugin).not.toContain("READ_EXTERNAL_STORAGE");
  });

  it("captures the opposite split-screen pane through user-authorized MediaProjection", () => {
    expect(mainActivity).toContain("registerPlugin(ScreenCapturePlugin.class)");
    expect(capturePlugin).toContain("createScreenCaptureIntent");
    expect(capturePlugin).toContain("captureOtherPane");
    expect(capturePlugin).toContain("static android.app.Activity.RESULT_OK");
    expect(captureService).toContain("FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION");
    expect(captureService).toContain("computeOtherPane");
    expect(captureService).toContain("Bitmap.createBitmap(full, crop.left, crop.top");
    expect(prepareScript).toContain("android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION");
    expect(prepareScript).toContain('android:foregroundServiceType="mediaProjection"');
    expect(prepareScript).toContain('android:resizeableActivity="true"');
    expect(pwaRegister).toContain('registerPlugin<NativeScreenCapturePlugin>("ScreenCapture")');
    expect(pwaRegister).toContain("📸 分屏截图");
  });

  it("checks for APK updates and hands installation to the Android package installer", () => {
    expect(mainActivity).toContain("registerPlugin(NativeUpdaterPlugin.class)");
    expect(updaterPlugin).toContain("checkForUpdate");
    expect(updaterPlugin).toContain("canRequestPackageInstalls");
    expect(updaterPlugin).toContain("FileProvider.getUriForFile");
    expect(updaterPlugin).toContain("application/vnd.android.package-archive");
    expect(prepareScript).toContain("android.permission.REQUEST_INSTALL_PACKAGES");
    expect(prepareScript).toContain("water_sort_file_paths");
    expect(pwaRegister).toContain('registerPlugin<NativeUpdaterPlugin>("NativeUpdater")');
    expect(pwaRegister).toContain("UPDATE_CHECK_INTERVAL");
    expect(pwaRegister).toContain("立即更新");
    expect(updateManifest.versionCode).toBe(8);
    expect(updateManifest.versionName).toBe("0.8.0");
  });

  it("uses a China-friendly Gitee mirror first and GitHub as an automatic fallback", () => {
    const giteeManifest = "https://gitee.com/octoteo/water-sort-solver-android/raw/main/latest.json";
    const giteeApk = "https://gitee.com/octoteo/water-sort-solver-android/releases/download/v0.8.0/Water-Sort-Solver.apk";
    const githubApk = "https://github.com/octoteo/water-sort-solver/releases/download/android-latest/Water-Sort-Solver.apk";
    expect(updaterPlugin).toContain(giteeManifest);
    expect(updaterPlugin.indexOf("GITEE_MANIFEST")).toBeLessThan(updaterPlugin.indexOf("GITHUB_RELEASE_MANIFEST"));
    expect(updaterPlugin).toContain("parseSources");
    expect(updaterPlugin).toContain("candidates.addAll(plan.sources)");
    expect(updateManifest.apkSources[0].url).toBe(giteeApk);
    expect(updateManifest.apkSources[1].url).toBe(githubApk);
    expect(generateManifestScript).toContain("releases/download/v${versionName}/Water-Sort-Solver.apk");
    expect(generateManifestScript).toContain(githubApk);
  });

  it("verifies mirrored APK bytes before opening the Android installer", () => {
    expect(updaterPlugin).toContain('MessageDigest.getInstance("SHA-256")');
    expect(updaterPlugin).toContain("verifySha256(target, expectedSha256)");
    expect(updaterPlugin).toContain("APK SHA-256 校验失败");
    expect(generateManifestScript).toContain('createHash("sha256")');
  });

  it("patches the generated Android manifest for image sharing and singleTask delivery", () => {
    expect(prepareScript).toContain("android.intent.action.SEND");
    expect(prepareScript).toContain('android:mimeType="image/*"');
    expect(prepareScript).toContain('android:launchMode="singleTask"');
  });

  it("hands native image sources into the same quick-solve file pipeline", () => {
    expect(pwaRegister).toContain('registerPlugin<NativeShareReceiverPlugin>("ShareReceiver")');
    expect(pwaRegister).toContain("Capacitor.convertFileSrc");
    expect(pwaRegister).toContain("dispatchImageFile");
    expect(pwaRegister).toContain('window.location.href = "/share.html?native=1"');
    expect(pwaRegister).toContain('window.location.pathname === "/share.html"');
    expect(pwaRegister).toContain("clearPendingShare");
  });

  it("builds one APK and publishes the same bytes to GitHub and a Gitee Release", () => {
    expect(workflow).toContain("npx cap add android");
    expect(workflow).toContain("sdkmanager \"platforms;android-36\"");
    expect(workflow).toContain("mkdir -p ~/.android");
    expect(workflow).toContain("water-sort-solver-debug-keystore-v2");
    expect(workflow).toContain("keytool -genkeypair");
    expect(workflow).toContain("./gradlew assembleDebug");
    expect(workflow).toContain("generate-update-manifest.mjs");
    expect(workflow).toContain("Water-Sort-Solver.apk");
    expect(workflow).toContain("gh release create android-latest Water-Sort-Solver.apk latest.json");
    expect(workflow).toContain("GITEE_TOKEN");
    expect(workflow).toContain("publish-gitee-release.mjs");
    expect(workflow).toContain("Verify public Gitee update mirror");
    expect(workflow).toContain("contents: write");
    expect(publishGiteeScript).toContain("/releases");
    expect(publishGiteeScript).toContain("attach_files");
    expect(publishGiteeScript).toContain("Water-Sort-Solver.apk");
    expect(publishGiteeScript).toContain("latest.json");
  });
});
