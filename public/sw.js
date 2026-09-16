const VERSION = "0.4.0";
const CORE_CACHE = `water-sort-core-${VERSION}`;
const RUNTIME_CACHE = `water-sort-runtime-${VERSION}`;
const SHARE_CACHE = "water-sort-shared-images-v1";
const SHARE_TTL_MS = 30 * 60 * 1000;
const PAGE_SHELLS = ["/", "/share"];
const CORE_ASSETS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/icon.svg",
];

async function precacheAppShell() {
  const cache = await caches.open(CORE_CACHE);
  const discoveredAssets = new Set(CORE_ASSETS);

  for (const path of PAGE_SHELLS) {
    try {
      const response = await fetch(path, { cache: "reload" });
      if (!response.ok) continue;
      await cache.put(path, response.clone());
      const html = await response.text();
      for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^\"]+)"/g)) {
        discoveredAssets.add(match[1].replaceAll("&amp;", "&"));
      }
    } catch {
      // Installation should remain usable even if one optional page shell fails.
    }
  }

  await Promise.all([...discoveredAssets].map(async (asset) => {
    try {
      const response = await fetch(asset, { cache: "reload" });
      if (response.ok) await cache.put(asset, response);
    } catch {
      // Runtime caching can recover assets later when the network is available.
    }
  }));
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(precacheAppShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => {
      if (name.startsWith("water-sort-core-") && name !== CORE_CACHE) return caches.delete(name);
      if (name.startsWith("water-sort-runtime-") && name !== RUNTIME_CACHE) return caches.delete(name);
      return Promise.resolve(false);
    }));
    await cleanupSharedCache();
    await self.clients.claim();
  })());
});

async function cleanupSharedCache() {
  const cache = await caches.open(SHARE_CACHE);
  const keys = await cache.keys();
  const now = Date.now();
  await Promise.all(keys.map(async (request) => {
    const response = await cache.match(request);
    const expiresAt = Number(response?.headers.get("x-water-sort-expires") || 0);
    if (expiresAt && expiresAt < now) await cache.delete(request);
  }));
}

function makeShareToken() {
  if (self.crypto?.randomUUID) return self.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function handleShareTarget(request) {
  await cleanupSharedCache();
  const formData = await request.formData();
  const candidates = formData.getAll("image");
  const file = candidates.find((value) => value && typeof value === "object" && typeof value.arrayBuffer === "function");
  if (!file || !(file.type || "").startsWith("image/")) {
    return Response.redirect(new URL("/share?error=missing-image", self.location.origin).toString(), 303);
  }

  const token = makeShareToken();
  const sharedUrl = new URL(`/__shared_image__/${token}`, self.location.origin).toString();
  const cache = await caches.open(SHARE_CACHE);
  await cache.put(new Request(sharedUrl), new Response(file, {
    headers: {
      "content-type": file.type || "application/octet-stream",
      "cache-control": "no-store",
      "x-water-sort-expires": String(Date.now() + SHARE_TTL_MS),
    },
  }));

  return Response.redirect(new URL(`/share?shared=${encodeURIComponent(token)}`, self.location.origin).toString(), 303);
}

async function readSharedImage(request) {
  const cache = await caches.open(SHARE_CACHE);
  const response = await cache.match(request);
  if (!response) return new Response("Shared image not found or expired", { status: 404 });
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, { ignoreSearch: true })) || (await caches.match(request, { ignoreSearch: true })) || (await caches.match("/")) || new Response("Offline", { status: 503 });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(handleShareTarget(request));
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/__shared_image__/")) {
    event.respondWith(readSharedImage(request));
    return;
  }

  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "delete-shared" || typeof data.token !== "string") return;
  event.waitUntil((async () => {
    const cache = await caches.open(SHARE_CACHE);
    const sharedUrl = new URL(`/__shared_image__/${data.token}`, self.location.origin).toString();
    await cache.delete(sharedUrl);
  })());
});
