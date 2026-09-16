import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const javaDir = resolve(root, "android/app/src/main/java/com/octoteo/watersortsolver");
const drawableDir = resolve(root, "android/app/src/main/res/drawable");
const manifestPath = resolve(root, "android/app/src/main/AndroidManifest.xml");
const appBuildGradlePath = resolve(root, "android/app/build.gradle");
const mainActivitySource = resolve(root, "native/android/MainActivity.java");
const sharePluginSource = resolve(root, "native/android/ShareReceiverPlugin.java");
const capturePluginSource = resolve(root, "native/android/ScreenCapturePlugin.java");
const captureServiceSource = resolve(root, "native/android/ScreenCaptureService.java");
const updaterPluginSource = resolve(root, "native/android/NativeUpdaterPlugin.java");
const installReceiverSource = resolve(root, "native/android/NativeInstallReceiver.java");
const updateDiagnosticsSource = resolve(root, "native/android/UpdateDiagnostics.java");
const iconSource = resolve(root, "public/icons/icon-512.png");
const roundIconSource = resolve(root, "public/icons/maskable-512.png");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const versionName = packageJson.version;
const versionCode = Number(packageJson.androidVersionCode);

if (!versionName || !Number.isInteger(versionCode) || versionCode <= 0) {
  throw new Error("package.json must define version and a positive integer androidVersionCode");
}

await mkdir(javaDir, { recursive: true });
await mkdir(drawableDir, { recursive: true });
await copyFile(mainActivitySource, resolve(javaDir, "MainActivity.java"));
await copyFile(sharePluginSource, resolve(javaDir, "ShareReceiverPlugin.java"));
await copyFile(capturePluginSource, resolve(javaDir, "ScreenCapturePlugin.java"));
await copyFile(captureServiceSource, resolve(javaDir, "ScreenCaptureService.java"));
await copyFile(updaterPluginSource, resolve(javaDir, "NativeUpdaterPlugin.java"));
await copyFile(installReceiverSource, resolve(javaDir, "NativeInstallReceiver.java"));
await copyFile(updateDiagnosticsSource, resolve(javaDir, "UpdateDiagnostics.java"));
await copyFile(iconSource, resolve(drawableDir, "water_sort_icon.png"));
await copyFile(roundIconSource, resolve(drawableDir, "water_sort_icon_round.png"));

let manifest = await readFile(manifestPath, "utf8");
const ensurePermission = (name) => {
  const declaration = `<uses-permission android:name="${name}" />`;
  if (!manifest.includes(declaration)) {
    manifest = manifest.replace("<application", `${declaration}\n\n    <application`);
  }
};

ensurePermission("android.permission.INTERNET");
ensurePermission("android.permission.REQUEST_INSTALL_PACKAGES");
ensurePermission("android.permission.FOREGROUND_SERVICE");
ensurePermission("android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION");

const shareAction = "android.intent.action.SEND";
if (!manifest.includes(shareAction)) {
  const shareFilter = `\n            <intent-filter>\n                <action android:name="android.intent.action.SEND" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <data android:mimeType="image/*" />\n            </intent-filter>`;
  const activityClose = manifest.indexOf("</activity>");
  if (activityClose < 0) throw new Error("Could not find MainActivity in AndroidManifest.xml");
  manifest = manifest.slice(0, activityClose) + shareFilter + "\n        " + manifest.slice(activityClose);
}

if (/android:launchMode="[^"]+"/.test(manifest)) {
  manifest = manifest.replace(/android:launchMode="[^"]+"/, 'android:launchMode="singleTask"');
}

if (!manifest.includes('android:resizeableActivity="true"')) {
  manifest = manifest.replace(/(<activity\b[^>]*android:name="\.MainActivity"[^>]*)(>)/, '$1 android:resizeableActivity="true"$2');
}

const captureService = `
        <service
            android:name=".ScreenCaptureService"
            android:exported="false"
            android:foregroundServiceType="mediaProjection" />`;
if (!manifest.includes('android:name=".ScreenCaptureService"')) {
  manifest = manifest.replace("</application>", `${captureService}\n    </application>`);
}

const installReceiver = `
        <receiver
            android:name=".NativeInstallReceiver"
            android:exported="false" />`;
if (!manifest.includes('android:name=".NativeInstallReceiver"')) {
  manifest = manifest.replace("</application>", `${installReceiver}\n    </application>`);
}

manifest = manifest
  .replace(/android:icon="@[^"]+"/, 'android:icon="@drawable/water_sort_icon"')
  .replace(/android:roundIcon="@[^"]+"/, 'android:roundIcon="@drawable/water_sort_icon_round"');

await writeFile(manifestPath, manifest);

let appBuildGradle = await readFile(appBuildGradlePath, "utf8");
appBuildGradle = appBuildGradle
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);
await writeFile(appBuildGradlePath, appBuildGradle);

console.log(`Prepared Capacitor Android shell: split-screen capture, PackageInstaller updater diagnostics, ACTION_SEND, version ${versionName} (${versionCode}).`);
