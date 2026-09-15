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
    expect(result.detections[0]?.selected).toBe(true);

    // This exact screenshot contains eight logical colors. Seven occupy one
    // completed cup each and one color appears in two cups, so the layer counts
    // must be 4,4,4,4,4,4,4,8. A yellow selected outline must never create a
    // ninth color.
    expect(result.palette).toHaveLength(8);
    const counts = new Map<number, number>();
    for (const cup of result.cups) {
      for (const color of cup) counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    expect([...counts.values()].sort((a, b) => a - b)).toEqual([4, 4, 4, 4, 4, 4, 4, 8]);
  });
});
