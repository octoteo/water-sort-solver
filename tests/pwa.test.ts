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
    expect(manifest.icons).toHaveLength(2);
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

  it("keeps shared images short-lived and explicitly deletable", () => {
    const source = readServiceWorker();
    expect(source).toContain("SHARE_TTL_MS = 30 * 60 * 1000");
    expect(source).toContain('data.type !== "delete-shared"');
    expect(source).toContain("cleanupSharedCache");
  });
});
