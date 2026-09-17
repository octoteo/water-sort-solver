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
const githubSource = (Array.isArray(manifest.apkSources) ? manifest.apkSources : []).find((source) =>
  typeof source?.url === "string" && source.url.startsWith(`https://github.com/octoteo/water-sort-solver/releases/download/${tag}/`),
) ?? {
  name: "GitHub 全球备用",
  url: `https://github.com/octoteo/water-sort-solver/releases/download/${tag}/Water-Sort-Solver.apk`,
};
const readme = `# Water Sort Solver Android\n\n本仓库用于 Water Sort Solver Android 的中国大陆更新发现与 APK 镜像。\n\n- 当前版本：v${version}\n- 优先镜像：Gitee Release（可用时）\n- 保底下载：GitHub 版本化 Release\n- 更新元数据：latest.json\n- 源码：https://github.com/octoteo/water-sort-solver\n\n应用会校验 latest.json 中记录的 SHA-256。Gitee 附件不可用时，latest.json 会自动降级到已验证的 GitHub 版本化 APK，避免发布不可下载或哈希不匹配的更新。\n`;

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

async function verifyRemoteApk(url, label, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(url, {
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
      console.log(`Verified ${label}, sha256=${remoteSha256}`);
      return true;
    } catch (error) {
      lastError = error;
      console.warn(`${label} verification attempt ${attempt}/${attempts} failed: ${error.message}`);
      if (attempt < attempts) await sleep(attempt * 3_000);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${label} is not publicly verifiable: ${lastError?.message ?? "unknown error"}`);
}

function buildDiscoveryManifest(giteeHealthy) {
  if (giteeHealthy) return `${JSON.stringify(manifest, null, 2)}\n`;

  const degraded = {
    ...manifest,
    apkUrl: githubSource.url,
    apkSources: [githubSource],
  };
  return `${JSON.stringify(degraded, null, 2)}\n`;
}

// A discovery manifest is allowed to move only when at least one immutable source
// is already public and byte-for-byte verified. GitHub is the canonical source;
// Gitee is an optional China mirror.
await verifyRemoteApk(githubSource.url, `GitHub canonical APK ${tag}`);

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
}

if (!release || !release.id) throw new Error(`Gitee Release ${tag} was not created or returned without an id`);

async function listAssets() {
  const response = await request(`${api}/releases/${release.id}/attach_files`);
  const items = await response.json();
  return Array.isArray(items) ? items : [];
}

async function upload(name, filePath) {
  const endpoint = `${api}/releases/${release.id}/attach_files`;
  const { stdout, stderr } = await execFile("curl", [
    "--fail-with-body",
    "--silent",
    "--show-error",
    "--location",
    "--connect-timeout", "15",
    "--max-time", "60",
    "-H", `Authorization: Bearer ${token}`,
    "-H", "Accept: application/json",
    "-H", "User-Agent: water-sort-solver-release-bot/0.9",
    "-F", `file=@${filePath};filename=${name}`,
    endpoint,
  ], {
    timeout: 70_000,
    maxBuffer: 1024 * 1024,
  });

  const asset = JSON.parse(stdout);
  if (asset?.id) return asset;
  throw new Error(`Gitee upload of ${name} returned no asset id: ${stdout.slice(0, 500)} ${stderr.slice(0, 200)}`);
}

let mirrorHealthy = false;
let apkAsset = null;

try {
  const existingApk = (await listAssets()).find((asset) => asset?.name === "Water-Sort-Solver.apk");
  if (existingApk) {
    try {
      await verifyRemoteApk(publicApkUrl, `existing Gitee APK ${tag}`, 1);
      mirrorHealthy = true;
      apkAsset = existingApk;
    } catch (error) {
      console.warn(`Existing Gitee APK is not usable; preserving it and falling back unless a replacement upload succeeds: ${error.message}`);
    }
  }

  if (!mirrorHealthy && !existingApk) {
    apkAsset = await upload("Water-Sort-Solver.apk", "Water-Sort-Solver.apk");
    await verifyRemoteApk(publicApkUrl, `Gitee mirror APK ${tag}`, 2);
    mirrorHealthy = true;
  }

  if (mirrorHealthy) {
    const existingManifest = (await listAssets()).find((asset) => asset?.name === "latest.json");
    if (!existingManifest) {
      try {
        await upload("latest.json", "latest.json");
      } catch (error) {
        console.warn(`Gitee latest.json release attachment upload failed; repository discovery file will still be updated: ${error.message}`);
      }
    }
  }
} catch (error) {
  console.warn(`Gitee APK mirror unavailable for ${tag}; publishing verified GitHub fallback manifest instead: ${error.message}`);
}

const discoveryManifestText = buildDiscoveryManifest(mirrorHealthy);
await writeFile("latest.json", discoveryManifestText, branch);

if (mirrorHealthy) {
  console.log(`Published Gitee Release ${tag} on ${branch}: ${apkAsset?.browser_download_url ?? publicApkUrl}`);
  console.log(`Published China-first discovery manifest after Gitee APK verification: ${tag}`);
} else {
  console.log(`Published degraded Gitee discovery manifest backed by verified GitHub versioned APK: ${githubSource.url}`);
}
