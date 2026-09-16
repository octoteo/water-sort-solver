import { readFile } from "node:fs/promises";

const token = process.env.GITEE_TOKEN;
if (!token) throw new Error("GITEE_TOKEN is required");

const owner = "octoteo";
const repo = "water-sort-solver-android";
const api = `https://gitee.com/api/v5/repos/${owner}/${repo}`;
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const version = packageJson.version;
const tag = `v${version}`;
const manifestText = await readFile("latest.json", "utf8");
const apk = await readFile("Water-Sort-Solver.apk");
const readme = `# Water Sort Solver Android\n\n本仓库仅用于 Water Sort Solver Android APK 的中国大陆下载镜像，不是源码仓库。\n\n- 当前镜像版本：v${version}\n- APK：Gitee Release 附件\n- 更新元数据：latest.json\n- 源码：https://github.com/octoteo/water-sort-solver\n\nAPK 由 GitHub Actions 自动构建并通过 Gitee OpenAPI 同步；应用会校验 latest.json 中记录的 SHA-256。\n`;

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
  "User-Agent": "water-sort-solver-release-bot/0.8",
};

async function request(url, options = {}, allowed = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
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

// Seed an empty repository using its default branch semantics. If the repo is
// already initialized this simply updates README.md.
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
await writeFile("latest.json", manifestText, branch);

let release;
const releaseResponse = await request(`${api}/releases/tags/${encodeURIComponent(tag)}`, {}, [404]);
if (releaseResponse.status === 404) {
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
  release = await releaseResponse.json();
  const patch = await request(`${api}/releases/${release.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: token,
      name: `Water Sort Solver Android v${version}`,
      body: `中国大陆 APK 更新镜像，版本 v${version}。`,
      prerelease: false,
    }),
  });
  release = await patch.json();
}

const assetsResponse = await request(`${api}/releases/${release.id}/attach_files`);
const assets = await assetsResponse.json();
for (const asset of Array.isArray(assets) ? assets : []) {
  if (asset?.name === "Water-Sort-Solver.apk" || asset?.name === "latest.json") {
    await request(`${api}/releases/${release.id}/attach_files/${asset.id}`, { method: "DELETE" });
  }
}

async function upload(name, bytes, type) {
  const form = new FormData();
  form.append("access_token", token);
  form.append("file", new Blob([bytes], { type }), name);
  const response = await request(`${api}/releases/${release.id}/attach_files`, {
    method: "POST",
    body: form,
  });
  return response.json();
}

const apkAsset = await upload("Water-Sort-Solver.apk", apk, "application/vnd.android.package-archive");
await upload("latest.json", Buffer.from(manifestText, "utf8"), "application/json");
console.log(`Published Gitee Release ${tag} on ${branch}: ${apkAsset.browser_download_url ?? "APK uploaded"}`);
