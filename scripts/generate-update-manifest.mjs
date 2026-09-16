import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const apkPath = resolve(root, process.argv[2] ?? "Water-Sort-Solver.apk");
const outputPath = resolve(root, process.argv[3] ?? "latest.json");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const apk = await readFile(apkPath);
const sha256 = createHash("sha256").update(apk).digest("hex");
const versionName = packageJson.version;
const versionCode = Number(packageJson.androidVersionCode);

if (!versionName || !Number.isInteger(versionCode) || versionCode <= 0) {
  throw new Error("package.json must define version and androidVersionCode");
}

// Gitee's Git smart-HTTP endpoint can be slow/unreachable from GitHub-hosted
// runners. The China mirror is therefore published through Gitee OpenAPI as a
// versioned Release attachment; the tiny latest.json stays in the repository.
const giteeApkUrl = `https://gitee.com/octoteo/water-sort-solver-android/releases/download/v${versionName}/Water-Sort-Solver.apk`;
const githubApkUrl = "https://github.com/octoteo/water-sort-solver/releases/download/android-latest/Water-Sort-Solver.apk";

const manifest = {
  versionCode,
  versionName,
  // v0.7 only understands apkUrl. Keep this field pointed at Gitee so existing
  // China users can make the one-time upgrade to the multi-source v0.8 client.
  apkUrl: giteeApkUrl,
  apkSources: [
    {
      name: "Gitee 中国镜像",
      url: giteeApkUrl,
    },
    {
      name: "GitHub 全球备用",
      url: githubApkUrl,
    },
  ],
  sha256,
  notes: "v0.8：中国大陆 Gitee 镜像优先、GitHub 自动兜底，并对下载 APK 做 SHA-256 完整性校验。",
};

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${outputPath}: v${versionName} (${versionCode}), sha256=${sha256}`);
