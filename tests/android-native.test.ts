import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const capacitorConfig = readFileSync(new URL("../capacitor.config.ts", import.meta.url), "utf8");
const mainActivity = readFileSync(new URL("../native/android/MainActivity.java", import.meta.url), "utf8");
const sharePlugin = readFileSync(new URL("../native/android/ShareReceiverPlugin.java", import.meta.url), "utf8");
const prepareScript = readFileSync(new URL("../scripts/prepare-android.mjs", import.meta.url), "utf8");
const pwaRegister = readFileSync(new URL("../app/pwa-register.tsx", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/android-apk.yml", import.meta.url), "utf8");

describe("v0.6 Android native contract", () => {
  it("bundles the static app into Capacitor 8 without a runtime server", () => {
    expect(packageJson.version).toBe("0.6.0");
    expect(packageJson.dependencies["@capacitor/core"]).toBe("8.5.2");
    expect(packageJson.dependencies["@capacitor/android"]).toBe("8.5.2");
    expect(packageJson.devDependencies["@capacitor/cli"]).toBe("8.5.2");
    expect(capacitorConfig).toContain('appId: "com.octoteo.watersortsolver"');
    expect(capacitorConfig).toContain('webDir: "out"');
    expect(capacitorConfig).not.toContain("server.url");
  });

  it("receives Android ACTION_SEND images without storage permission", () => {
    expect(mainActivity).toContain("registerPlugin(ShareReceiverPlugin.class)");
    expect(mainActivity).toContain("onNewIntent");
    expect(sharePlugin).toContain("Intent.ACTION_SEND");
    expect(sharePlugin).toContain("Intent.EXTRA_STREAM");
    expect(sharePlugin).toContain("getCacheDir()");
    expect(sharePlugin).toContain('@CapacitorPlugin(name = "ShareReceiver")');
    expect(sharePlugin).not.toContain("READ_MEDIA_IMAGES");
    expect(sharePlugin).not.toContain("READ_EXTERNAL_STORAGE");
  });

  it("patches the generated Android manifest for image sharing and singleTask delivery", () => {
    expect(prepareScript).toContain("android.intent.action.SEND");
    expect(prepareScript).toContain('android:mimeType="image/*"');
    expect(prepareScript).toContain('android:launchMode="singleTask"');
  });

  it("hands native shared files into the same quick-solve file pipeline", () => {
    expect(pwaRegister).toContain('registerPlugin<NativeShareReceiverPlugin>("ShareReceiver")');
    expect(pwaRegister).toContain("Capacitor.convertFileSrc");
    expect(pwaRegister).toContain("dispatchImageFile");
    expect(pwaRegister).toContain('window.location.href = "/share?native=1"');
    expect(pwaRegister).toContain("clearPendingShare");
  });

  it("builds an installable APK in GitHub Actions", () => {
    expect(workflow).toContain("npx cap add android");
    expect(workflow).toContain("sdkmanager \"platforms;android-36\"");
    expect(workflow).toContain("./gradlew assembleDebug");
    expect(workflow).toContain("android/app/build/outputs/apk/debug/app-debug.apk");
  });
});
