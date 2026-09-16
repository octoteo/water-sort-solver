import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifestPath = new URL("../public/manifest.webmanifest", import.meta.url);
const serviceWorkerPath = new URL("../public/sw.js", import.meta.url);

function readServiceWorker() {
  return readFileSync(serviceWorkerPath, "utf8");
}

describe("PWA contract", () => {
  it("is installable and accepts Android image shares", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons.some((icon: { sizes: string; type: string }) => icon.sizes === "192x192" && icon.type === "image/png")).toBe(true);
    expect(manifest.icons.some((icon: { sizes: string; type: string }) => icon.sizes === "512x512" && icon.type === "image/png")).toBe(true);
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(true);
    expect(manifest.share_target).toMatchObject({
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
    });
    expect(manifest.share_target.params.files[0]).toMatchObject({ name: "image" });
    expect(manifest.share_target.params.files[0].accept).toContain("image/*");
  });

  it("intercepts the share POST locally instead of forwarding it to the network", () => {
    const source = readServiceWorker();
    expect(source).toContain('request.method === "POST" && url.pathname === "/share-target"');
    expect(source).toContain("request.formData()");
    expect(source).toContain("water-sort-shared-images-v1");
    expect(source).toContain("/__shared_image__/");
    expect(source).toContain("/share?shared=");

    const start = source.indexOf("async function handleShareTarget");
    const end = source.indexOf("async function readSharedImage");
    const shareHandler = source.slice(start, end);
    expect(shareHandler).not.toContain("fetch(");
  });

  it("keeps shared images short-lived, deletable and makes the share page available offline", () => {
    const source = readServiceWorker();
    expect(source).toContain("SHARE_TTL_MS = 30 * 60 * 1000");
    expect(source).toContain('data.type !== "delete-shared"');
    expect(source).toContain("cleanupSharedCache");
    expect(source).toContain('"/share"');
    expect(source).toContain('"/icons/icon-192.png"');
    expect(source).toContain('"/icons/icon-512.png"');
  });
});
