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
  notes: `v${versionName}：修复 MIUI/小米安装器更新失败。APK 下载与 SHA-256 校验完成后改用 Android PackageInstaller.Session 写入和提交安装包，不再让 OEM 安装器读取应用 FileProvider；连续分屏求解与识别完整性安全门继续保留。`,
};

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${outputPath}: v${versionName} (${versionCode}), sha256=${sha256}`);
