import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const javaDir = resolve(root, "android/app/src/main/java/com/octoteo/watersortsolver");
const manifestPath = resolve(root, "android/app/src/main/AndroidManifest.xml");
const mainActivitySource = resolve(root, "native/android/MainActivity.java");
const sharePluginSource = resolve(root, "native/android/ShareReceiverPlugin.java");

await mkdir(javaDir, { recursive: true });
await copyFile(mainActivitySource, resolve(javaDir, "MainActivity.java"));
await copyFile(sharePluginSource, resolve(javaDir, "ShareReceiverPlugin.java"));

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
manifest = manifest.replace(
  /android:launchMode="[^"]+"/,
  'android:launchMode="singleTask"',
);

await writeFile(manifestPath, manifest);
console.log("Prepared Capacitor Android shell with local ACTION_SEND image receiver.");
