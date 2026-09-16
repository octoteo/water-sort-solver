import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const token = process.env.GITEE_TOKEN;
if (!token) throw new Error("GITEE_TOKEN is required");

const owner = "octoteo";
const repo = "water-sort-solver-android";
const api = `https://gitee.com/api/v5/repos/${owner}/${repo}`;
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const version = packageJson.version;
const tag = `v${version}`;
const manifestText = await readFile("latest.json", "utf8");
const manifest = JSON.parse(manifestText);
const apk = await readFile("Water-Sort-Solver.apk");
const expectedSha256 = String(manifest.sha256 ?? "").trim().toLowerCase();
const actualSha256 = createHash("sha256").update(apk).digest("hex");
const publicApkUrl = `https://gitee.com/${owner}/${repo}/releases/download/${tag}/Water-Sort-Solver.apk`;
const readme = `# Water Sort Solver Android\n\n本仓库仅用于 Water Sort Solver Android APK 的中国大陆下载镜像，不是源码仓库。\n\n- 当前镜像版本：v${version}\n- APK：Gitee Release 附件\n- 更新元数据：latest.json\n- 源码：https://github.com/octoteo/water-sort-solver\n\nAPK 由 GitHub Actions 自动构建并通过 Gitee OpenAPI 同步；应用会校验 latest.json 中记录的 SHA-256。\n`;

if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
  throw new Error("latest.json must contain a valid SHA-256 before publishing");
}
if (actualSha256 !== expectedSha256) {
  throw new Error(`local APK SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
  "User-Agent": "water-sort-solver-release-bot/0.9",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url, options = {}, allowed = [], timeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...(options.headers ?? {}) },
      signal: controller.signal,
    });
    if (!response.ok && !allowed.includes(response.status)) {
      const text = await response.text();
      throw new Error(`${options.method ?? "GET"} ${url} -> HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function getRepo() {
  const response = await request(api);
  return response.json();
}

async function getContent(path, branch) {
  const query = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  const response = await request(`${api}/contents/${encodeURIComponent(path)}${query}`, {}, [404]);
  if (response.status === 404) return null;
  return response.json();
}

async function writeFile(path, text, branch) {
  const existing = await getContent(path, branch);
  const payload = {
    access_token: token,
    content: Buffer.from(text, "utf8").toString("base64"),
    message: `release: Android v${version}`,
    ...(branch ? { branch } : {}),
    ...(existing?.sha ? { sha: existing.sha } : {}),
  };
  const method = existing ? "PUT" : "POST";
  await request(`${api}/contents/${encodeURIComponent(path)}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

let repoInfo = await getRepo();
let branch = repoInfo.default_branch || "main";

try {
  await writeFile("README.md", readme, branch);
} catch (error) {
  if (!repoInfo.default_branch) {
    await writeFile("README.md", readme, undefined);
  } else {
    throw error;
  }
}

repoInfo = await getRepo();
branch = repoInfo.default_branch || branch || "main";

let release = null;
const releaseResponse = await request(`${api}/releases/tags/${encodeURIComponent(tag)}`, {}, [404]);
if (releaseResponse.status !== 404) release = await releaseResponse.json();

if (!release || !release.id) {
  const create = await request(`${api}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: token,
      tag_name: tag,
      target_commitish: branch,
      name: `Water Sort Solver Android v${version}`,
      body: `中国大陆 APK 更新镜像，版本 v${version}。`,
      prerelease: false,
    }),
  });
  release = await create.json();
} else {
  const patch = await request(`${api}/releases/${release.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: token,
      tag_name: tag,
      target_commitish: branch,
      name: `Water Sort Solver Android v${version}`,
      body: `中国大陆 APK 更新镜像，版本 v${version}。`,
      prerelease: false,
    }),
  });
  release = await patch.json();
}

if (!release || !release.id) throw new Error(`Gitee Release ${tag} was not created or returned without an id`);

async function listAssets() {
  const response = await request(`${api}/releases/${release.id}/attach_files`);
  const items = await response.json();
  return Array.isArray(items) ? items : [];
}

for (const asset of await listAssets()) {
  if (asset?.name === "Water-Sort-Solver.apk" || asset?.name === "latest.json") {
    await request(`${api}/releases/${release.id}/attach_files/${asset.id}`, { method: "DELETE" });
  }
}

async function upload(name, filePath) {
  let lastError;
  const endpoint = `${api}/releases/${release.id}/attach_files`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Use curl's mature multipart implementation rather than Node/undici FormData.
      // Gitee's own SDK/examples use a normal multipart file upload on this endpoint.
      const { stdout, stderr } = await execFile("curl", [
        "--fail-with-body",
        "--silent",
        "--show-error",
        "--location",
        "--connect-timeout", "15",
        "--max-time", "90",
        "--retry", "2",
        "--retry-delay", "3",
        "--retry-connrefused",
        "-H", `Authorization: Bearer ${token}`,
        "-H", "Accept: application/json",
        "-H", "User-Agent: water-sort-solver-release-bot/0.9",
        "-F", `file=@${filePath};filename=${name}`,
        endpoint,
      ], {
        timeout: 100_000,
        maxBuffer: 1024 * 1024,
      });

      const asset = JSON.parse(stdout);
      if (asset?.id) return asset;
      throw new Error(`Gitee upload of ${name} returned no asset id: ${stdout.slice(0, 500)} ${stderr.slice(0, 200)}`);
    } catch (error) {
      lastError = error;
      try {
        const existing = (await listAssets()).find((asset) => asset?.name === name);
        if (existing?.id) {
          console.log(`Gitee upload of ${name} became visible after client error; accepting asset id ${existing.id}`);
          return existing;
        }
      } catch {
        // Preserve the original upload error and retry below.
      }
      if (attempt < 3) {
        console.warn(`Gitee curl upload ${name} attempt ${attempt}/3 failed; retrying...`);
        await sleep(attempt * 5_000);
      }
    }
  }
  throw lastError;
}

async function verifyPublicApk() {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(publicApkUrl, {
        headers: {
          Accept: "application/vnd.android.package-archive,*/*",
          "User-Agent": "WaterSortSolver-Android/0.9",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const remoteSha256 = createHash("sha256").update(bytes).digest("hex");
      if (remoteSha256 !== expectedSha256) {
        throw new Error(`SHA-256 mismatch: expected ${expectedSha256}, got ${remoteSha256}`);
      }
      console.log(`Verified public Gitee APK ${tag}, sha256=${remoteSha256}`);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`Gitee public APK verification attempt ${attempt}/5 failed: ${error.message}`);
      if (attempt < 5) await sleep(attempt * 5_000);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Gitee APK was uploaded but never became publicly verifiable: ${lastError?.message ?? "unknown error"}`);
}

const apkAsset = await upload("Water-Sort-Solver.apk", "Water-Sort-Solver.apk");
await upload("latest.json", "latest.json");
await verifyPublicApk();

// Publish the discovery manifest only after the release asset is publicly downloadable
// and byte-for-byte identical. If any earlier step fails, clients keep seeing the
// previous healthy version instead of a phantom update.
await writeFile("latest.json", manifestText, branch);

console.log(`Published Gitee Release ${tag} on ${branch}: ${apkAsset.browser_download_url ?? publicApkUrl}`);
console.log(`Published discovery manifest only after public APK verification: ${tag}`);
