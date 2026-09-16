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
const githubApkUrl = `https://github.com/octoteo/water-sort-solver/releases/download/v${versionName}/Water-Sort-Solver.apk`;

const manifest = {
  versionCode,
  versionName,
  apkUrl: giteeApkUrl,
  apkSources: [
    { name: "Gitee 中国镜像", url: giteeApkUrl },
    { name: "GitHub 全球备用", url: githubApkUrl },
  ],
  sha256,
  notes: `v${versionName}：新增本机更新诊断中心。记录更新清单与下载 HTTP 响应、APK SHA-256、包名/版本/签名预检、PackageInstaller Session、系统安装回调以及确认页启动结果；诊断信息默认只保存在本机，可一键复制用于定位 MIUI/HyperOS 更新失败根因。`,
};

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${outputPath}: v${versionName} (${versionCode}), sha256=${sha256}`);
