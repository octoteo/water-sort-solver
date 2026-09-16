import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const javaDir = resolve(root, "android/app/src/main/java/com/octoteo/watersortsolver");
const drawableDir = resolve(root, "android/app/src/main/res/drawable");
const manifestPath = resolve(root, "android/app/src/main/AndroidManifest.xml");
const appBuildGradlePath = resolve(root, "android/app/build.gradle");
const mainActivitySource = resolve(root, "native/android/MainActivity.java");
const sharePluginSource = resolve(root, "native/android/ShareReceiverPlugin.java");
const iconSource = resolve(root, "public/icons/icon-512.png");
const roundIconSource = resolve(root, "public/icons/maskable-512.png");

await mkdir(javaDir, { recursive: true });
await mkdir(drawableDir, { recursive: true });
await copyFile(mainActivitySource, resolve(javaDir, "MainActivity.java"));
await copyFile(sharePluginSource, resolve(javaDir, "ShareReceiverPlugin.java"));
await copyFile(iconSource, resolve(drawableDir, "water_sort_icon.png"));
await copyFile(roundIconSource, resolve(drawableDir, "water_sort_icon_round.png"));

let manifest = await readFile(manifestPath, "utf8");
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

// Use the Water Sort artwork instead of the default Capacitor launcher icon.
manifest = manifest
  .replace(/android:icon="@[^"]+"/, 'android:icon="@drawable/water_sort_icon"')
  .replace(/android:roundIcon="@[^"]+"/, 'android:roundIcon="@drawable/water_sort_icon_round"');

await writeFile(manifestPath, manifest);

let appBuildGradle = await readFile(appBuildGradlePath, "utf8");
appBuildGradle = appBuildGradle
  .replace(/versionCode\s+\d+/, "versionCode 6")
  .replace(/versionName\s+"[^"]+"/, 'versionName "0.6.0"');
await writeFile(appBuildGradlePath, appBuildGradle);

console.log("Prepared Capacitor Android shell: ACTION_SEND, Water Sort icon, version 0.6.0.");
