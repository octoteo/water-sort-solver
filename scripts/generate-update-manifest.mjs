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

const giteeApkUrl = `https://gitee.com/octoteo/water-sort-solver-android/releases/download/v${versionName}/Water-Sort-Solver.apk`;
const githubApkUrl = "https://github.com/octoteo/water-sort-solver/releases/download/android-latest/Water-Sort-Solver.apk";

const manifest = {
  versionCode,
  versionName,
  apkUrl: giteeApkUrl,
  apkSources: [
    { name: "Gitee 中国镜像", url: giteeApkUrl },
    { name: "GitHub 全球备用", url: githubApkUrl },
  ],
  sha256,
  notes: `v${versionName}：MIUI 真机自动更新验证版本。继续使用 Android PackageInstaller.Session 安装链路，不再通过 FileProvider 交付 APK；用于验证上一版本可直接在应用内下载并覆盖更新。`,
};

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${outputPath}: v${versionName} (${versionCode}), sha256=${sha256}`);
