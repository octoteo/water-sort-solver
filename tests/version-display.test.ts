import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const versionCss = readFileSync(new URL("../app/v06.css", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

describe("release version display contract", () => {
  it("derives visible version labels from package.json instead of hardcoding a release", () => {
    expect(layout).toContain('import packageJson from "../package.json"');
    expect(layout).toContain('"--app-version": `"v${packageJson.version}"`');
    expect(versionCss).toContain("content:var(--app-version)");
    expect(versionCss).toContain('content:"ANDROID NATIVE + QUICK SOLVE · " var(--app-version)');
    expect(versionCss).not.toMatch(/content:\"v\d/i);
    expect(versionCss).not.toMatch(/V0\.\d/);
  });

  it("keeps the web offline cache on the same release version", () => {
    expect(serviceWorker).toContain(`const VERSION = "${packageJson.version}"`);
  });
});
