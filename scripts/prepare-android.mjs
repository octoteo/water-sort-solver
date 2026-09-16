import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const javaDir = resolve(root, "android/app/src/main/java/com/octoteo/watersortsolver");
const drawableDir = resolve(root, "android/app/src/main/res/drawable");
const xmlDir = resolve(root, "android/app/src/main/res/xml");
const manifestPath = resolve(root, "android/app/src/main/AndroidManifest.xml");
const appBuildGradlePath = resolve(root, "android/app/build.gradle");
const mainActivitySource = resolve(root, "native/android/MainActivity.java");
const sharePluginSource = resolve(root, "native/android/ShareReceiverPlugin.java");
const capturePluginSource = resolve(root, "native/android/ScreenCapturePlugin.java");
const captureServiceSource = resolve(root, "native/android/ScreenCaptureService.java");
const updaterPluginSource = resolve(root, "native/android/NativeUpdaterPlugin.java");
const iconSource = resolve(root, "public/icons/icon-512.png");
const roundIconSource = resolve(root, "public/icons/maskable-512.png");

await mkdir(javaDir, { recursive: true });
await mkdir(drawableDir, { recursive: true });
await mkdir(xmlDir, { recursive: true });
await copyFile(mainActivitySource, resolve(javaDir, "MainActivity.java"));
await copyFile(sharePluginSource, resolve(javaDir, "ShareReceiverPlugin.java"));
await copyFile(capturePluginSource, resolve(javaDir, "ScreenCapturePlugin.java"));
await copyFile(captureServiceSource, resolve(javaDir, "ScreenCaptureService.java"));
await copyFile(updaterPluginSource, resolve(javaDir, "NativeUpdaterPlugin.java"));
await copyFile(iconSource, resolve(drawableDir, "water_sort_icon.png"));
await copyFile(roundIconSource, resolve(drawableDir, "water_sort_icon_round.png"));

await writeFile(resolve(xmlDir, "water_sort_file_paths.xml"), `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <cache-path name="updates" path="updates/" />
</paths>
`);

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

// Sharing a second screenshot while the app is already open should reach the
// existing activity so onNewIntent() can hand the image to the WebView.
if (/android:launchMode="[^"]+"/.test(manifest)) {
  manifest = manifest.replace(/android:launchMode="[^"]+"/, 'android:launchMode="singleTask"');
}

// Explicitly keep the Activity resizable so Water Sort can sit above/beside
// the game while MediaProjection captures the opposite split-screen pane.
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

const updateProvider = `
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="\${applicationId}.files"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/water_sort_file_paths" />
        </provider>`;
if (!manifest.includes('android:resource="@xml/water_sort_file_paths"')) {
  manifest = manifest.replace("</application>", `${updateProvider}\n    </application>`);
}

// Use the Water Sort artwork instead of the default Capacitor launcher icon.
manifest = manifest
  .replace(/android:icon="@[^"]+"/, 'android:icon="@drawable/water_sort_icon"')
  .replace(/android:roundIcon="@[^"]+"/, 'android:roundIcon="@drawable/water_sort_icon_round"');

await writeFile(manifestPath, manifest);

let appBuildGradle = await readFile(appBuildGradlePath, "utf8");
appBuildGradle = appBuildGradle
  .replace(/versionCode\s+\d+/, "versionCode 7")
  .replace(/versionName\s+"[^"]+"/, 'versionName "0.7.0"');
await writeFile(appBuildGradlePath, appBuildGradle);

console.log("Prepared Capacitor Android shell: split-screen capture, APK updater, ACTION_SEND, version 0.7.0.");
