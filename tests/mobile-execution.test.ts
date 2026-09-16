import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sharePage = readFileSync(new URL("../app/share/page.tsx", import.meta.url), "utf8");
const historyStore = readFileSync(new URL("../lib/local-history.ts", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

describe("v0.5+ mobile execution contract", () => {
  it("keeps continuous play controls on the quick-solve page", () => {
    expect(sharePage).toContain("ANDROID QUICK SOLVE · V0.5");
    expect(sharePage).toContain("完成第 ${step + 1} 步");
    expect(sharePage).toContain("下一关截图");
    expect(sharePage).toContain("误点了，退一步");
  });

  it("supports screen wake lock without making it mandatory", () => {
    expect(sharePage).toContain('request: (type: "screen")');
    expect(sharePage).toContain('nav.wakeLock.request("screen")');
    expect(sharePage).toContain("不支持防息屏");
    expect(sharePage).toContain("防息屏被系统限制");
  });

  it("stores optional screenshot history only in browser IndexedDB", () => {
    expect(historyStore).toContain('const DB_NAME = "water-sort-local"');
    expect(historyStore).toContain('const MAX_ITEMS = 8');
    expect(historyStore).toContain('const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000');
    expect(historyStore).toContain("indexedDB.open");
    expect(historyStore).not.toContain("fetch(");
    expect(sharePage).toContain("historyEnabled: false");
  });

  it("persists execution progress and remembers the Taote skin profile locally", () => {
    expect(sharePage).toContain('skinProfile: "taote-water-sort-v1"');
    expect(sharePage).toContain("water-sort-progress-");
    expect(sharePage).toContain("localStorage.setItem(progressKey, String(step))");
  });

  it("bumps the offline application shell cache for the current release", () => {
    expect(serviceWorker).toContain('const VERSION = "0.9.2"');
    expect(serviceWorker).toContain('const PAGE_SHELLS = ["/", "/share"]');
  });
});
