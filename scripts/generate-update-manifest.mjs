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

const manifest = {
  versionCode,
  versionName,
  // Keep apkUrl for v0.7 and older clients. v0.8+ uses apkSources and falls back automatically.
  apkUrl: "https://github.com/octoteo/water-sort-solver/releases/download/android-latest/Water-Sort-Solver.apk",
  apkSources: [
    {
      name: "Gitee 中国镜像",
      url: "https://gitee.com/octoteo/water-sort-solver-android/raw/main/Water-Sort-Solver.apk",
    },
    {
      name: "GitHub 全球备用",
      url: "https://github.com/octoteo/water-sort-solver/releases/download/android-latest/Water-Sort-Solver.apk",
    },
  ],
  sha256,
  notes: "v0.8：中国大陆 Gitee 镜像优先、GitHub 自动兜底，并对下载 APK 做 SHA-256 完整性校验。",
};

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${outputPath}: v${versionName} (${versionCode}), sha256=${sha256}`);
