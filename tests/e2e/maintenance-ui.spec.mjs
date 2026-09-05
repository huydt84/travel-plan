import { expect, gotoHealthy, test } from "./fixtures.mjs";

for (const viewport of [{ name: "phone", width: 320, height: 760 }, { name: "macbook", width: 1440, height: 900 }, { name: "dell", width: 1920, height: 1080 }]) {
  test(`${viewport.name} completed trips omit timers and target trip-level feedback`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.clock.install({ time: new Date("2040-01-01T00:00:00Z") });
    await gotoHealthy(page, "/");
    const station = page.locator(viewport.width === 320 ? ".mobile-active-foldout" : ".now-station");
    await expect(station).toContainText("Hoàn tất lúc 23:59");
    await expect(station.locator(".countdown-wrap, .mobile-foldout-countdown")).toHaveCount(0);
    await expect(page.locator(".mobile-live-dock")).toHaveCount(0);
    const heading = station.locator("h1");
    await expect(heading).toContainText("Chuyến đi");
    const line = await heading.evaluate((element) => {
      const style = getComputedStyle(element);
      return { height: parseFloat(style.lineHeight), font: parseFloat(style.fontSize), overflow: element.scrollWidth > element.clientWidth };
    });
    expect(line.height).toBeGreaterThanOrEqual(line.font);
    expect(line.overflow).toBe(false);
    await station.getByRole("button", { name: /Góp ý/ }).click();
    await expect(page.getByRole("dialog")).toContainText("chuyến đi");
    await page.screenshot({ path: testInfo.outputPath("completed-feedback.png"), fullPage: true });
  });

  test(`${viewport.name} schedule nodes align and request rows contain their text`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await gotoHealthy(page, "/admin/trips");
    const alignment = await page.locator(".admin-schedule-item").first().evaluate((item) => {
      const list = item.closest(".admin-schedule-list");
      const line = getComputedStyle(list, "::before"), node = getComputedStyle(item, "::before");
      const outerWidth = (style) => parseFloat(style.width) + (style.boxSizing === "border-box" ? 0 : parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth));
      return Math.abs(list.getBoundingClientRect().left + parseFloat(line.left) + outerWidth(line) / 2 - item.getBoundingClientRect().left - parseFloat(node.left) - outerWidth(node) / 2);
    });
    expect(alignment).toBeLessThanOrEqual(0.5);
    await gotoHealthy(page, "/admin/requests");
    await expect(page.locator(".request-admin-row").first()).toBeVisible();
    const overflows = await page.locator(".request-admin-row").evaluateAll((rows) => rows.filter((row) => {
      const rect = row.getBoundingClientRect();
      return [...row.querySelectorAll("b, small, em")].some((child) => child.getBoundingClientRect().bottom > rect.bottom + 1);
    }).length);
    expect(overflows, "request titles and metadata must stay inside their row").toBe(0);
    await page.screenshot({ path: testInfo.outputPath("request-queue.png"), fullPage: true });
  });
}

test("desktop route has no end padding and connects the focused stop to the station notch", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoHealthy(page, "/");
  const padding = await page.locator(".route-stops").evaluate((element) => [getComputedStyle(element).paddingTop, getComputedStyle(element).paddingBottom]);
  expect(padding).toEqual(["0px", "0px"]);
  await expect(page.locator(".now-station")).toHaveAttribute("style", /--station-notch-y:.*px/);
  const alignment = await page.locator(".station-stage").evaluate((stage) => {
    const before = getComputedStyle(stage, "::before"), after = getComputedStyle(stage, "::after");
    const station = stage.querySelector(".now-station");
    const notch = parseFloat(getComputedStyle(station).getPropertyValue("--station-notch-y"));
    return { before: parseFloat(before.top), after: parseFloat(after.top), notch: station.getBoundingClientRect().top - stage.getBoundingClientRect().top + notch };
  });
  expect(alignment.before).toBeCloseTo(alignment.after, 0);
  expect(Math.abs(alignment.before - alignment.notch)).toBeLessThanOrEqual(2);
});

test("anonymous heartbeat stops after its first unauthorized response", async ({ page, runtimeHealth }) => {
  let calls = 0;
  await page.clock.install();
  await page.route("**/api/activity", async (route) => { calls += 1; await route.fulfill({ status: 401 }); });
  await gotoHealthy(page, "/");
  await expect.poll(() => calls).toBeGreaterThan(0);
  await page.waitForTimeout(100);
  const initialCalls = calls;
  await page.clock.fastForward(15 * 60 * 1000);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(calls).toBe(initialCalls);
  // The intentional HTTP 401 is reported by Chromium's console.
  const expected = runtimeHealth.filter((message) => message.includes("401"));
  expect(expected.length).toBe(initialCalls);
  runtimeHealth.splice(0, runtimeHealth.length, ...runtimeHealth.filter((message) => !message.includes("401")));
});
