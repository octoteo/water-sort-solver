import { readFileSync } from "node:fs";
import { decode } from "jpeg-js";
import { describe, expect, it } from "vitest";
import { recognizeScreenshot } from "../lib/recognizer";

function loadFixture() {
  const base64 = readFileSync(new URL("./fixtures/selected-android.b64", import.meta.url), "utf8").replace(/\s/g, "");
  const bytes = Buffer.from(base64, "base64");
  const decoded = decode(bytes, { useTArray: true });
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
  };
}

describe("real screenshot recognition", () => {
  it("recognizes the Android level with a selected cup without treating the yellow outline as liquid", () => {
    const result = recognizeScreenshot(loadFixture());

    expect(result.rows).toBe(3);
    expect(result.detections).toHaveLength(12);
    expect(result.locked).toEqual([2]);
    expect(result.detections.filter((detection) => detection.type === "empty")).toHaveLength(2);
    expect(result.cups[0]).toHaveLength(4);

    // The yellow outline is UI chrome, not a puzzle color. The solver state for
    // this screenshot contains eight logical colors: seven occupy one completed
    // cup each and one color appears in two cups.
    expect(result.palette).toHaveLength(8);
    const counts = new Map<number, number>();
    for (const cup of result.cups) {
      for (const color of cup) counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    expect([...counts.values()].sort((a, b) => a - b)).toEqual([4, 4, 4, 4, 4, 4, 4, 8]);
  });
});
