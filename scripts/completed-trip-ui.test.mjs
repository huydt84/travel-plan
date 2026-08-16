import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const tracker = await readFile(new URL("../components/TripTracker.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("completed trips use their canonical end time and a trip-level suggestion target", () => {
  assert.match(tracker, /range = `Hoàn tất lúc \$\{state\.anchor\.end\}`/);
  assert.match(tracker, /stationSuggestionActivityId = isAfter \? null : state\.current\.id/);
  assert.doesNotMatch(tracker, /countdown = \{ value: "✓"/);
  assert.doesNotMatch(tracker, /Kết thúc \$\{state\.current\.displayEnd/);
});

test("completed trips omit countdown furniture and the mobile live dock", () => {
  assert.match(tracker, /!isAfter && <div className="countdown-wrap">/);
  assert.match(tracker, /!isAfter && <div className="mobile-foldout-countdown">/);
  assert.match(tracker, /!isAfter && <button className="mobile-live-dock"/);
  assert.match(tracker, /data-mode=\{state\.mode\}/);
});

test("multiline Vietnamese display titles reserve their full line box", () => {
  assert.match(styles, /\.station-copy h1\s*\{[^}]*\/1 var\(--display\)/);
  assert.match(styles, /\.mobile-foldout-title h1\s*\{[^}]*\/1 var\(--display\)/);
});
