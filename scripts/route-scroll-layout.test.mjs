import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const tracker = await readFile(new URL("../components/TripTracker.jsx", import.meta.url), "utf8");

const ruleBodies = (selector) => [...styles.matchAll(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g"))].map((match) => match[1]);
const pixelValue = (rule, property) => Number(rule.match(new RegExp(`${property}\\s*:\\s*(\\d+)px`))?.[1]);

test("desktop route scroller has no artificial blank space at either end", () => {
  const routeStopsRule = styles.match(/\.route-stops\s*\{([^}]*)\}/)?.[1];

  assert.ok(routeStopsRule, "expected the .route-stops rule to exist");
  assert.match(
    routeStopsRule,
    /padding:\s*0(?:\s+0)?\s*;/,
    "the route scroller must not add vertical padding that appears as blank scroll space",
  );
});

test("desktop foldout connector shares one vertical anchor with the active stop and station notch", () => {
  assert.match(styles, /\.station-stage::before\s*\{[^}]*top:\s*var\(--route-connection-y\)/);
  assert.match(styles, /\.station-stage::after\s*\{[^}]*top:\s*var\(--route-connection-y\)/);
  assert.match(styles, /\.now-station\s*\{[^}]*--station-notch-y/);
  assert.match(tracker, /setProperty\("--route-connection-y"/);
  assert.match(tracker, /setProperty\("--station-notch-y"/);
});

test("admin schedule nodes stay centered on the route line", () => {
  const [lineBase, lineMobile] = ruleBodies(".admin-schedule-list::before");
  const [nodeBase, nodeMobile] = ruleBodies(".admin-schedule-item::before");
  const lineWidth = pixelValue(lineBase, "width");
  const nodeOuterWidth = pixelValue(nodeBase, "width") + 2 * pixelValue(nodeBase, "border");

  const desktopLineCenter = pixelValue(lineBase, "left") + lineWidth / 2;
  const desktopNodeCenter = pixelValue(nodeBase, "left") + nodeOuterWidth / 2;
  const mobileLineCenter = pixelValue(lineMobile, "left") + lineWidth / 2;
  const mobileNodeCenter = pixelValue(nodeMobile, "left") + nodeOuterWidth / 2;

  assert.equal(desktopNodeCenter, desktopLineCenter, "desktop node must share the line center");
  assert.equal(mobileNodeCenter, mobileLineCenter, "mobile node must share the line center");
});
