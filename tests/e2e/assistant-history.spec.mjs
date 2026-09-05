import { expect, gotoHealthy, test } from "./fixtures.mjs";

async function recordMotion(page) {
  await page.addInitScript(() => {
    window.assistantMotion = [];
    document.addEventListener("animationstart", (event) => {
      window.assistantMotion.push({ name: event.animationName, pseudo: event.pseudoElement,
        duration: getComputedStyle(event.target, event.pseudoElement || null).animationDuration });
    }, true);
  });
}
async function settle(page) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))));
}

for (const viewport of [{ width: 320, height: 760 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`left history lists all trips and retains navigation at ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await recordMotion(page);
    let trips;
    const requests = [];
    await page.route("**/api/v1/assistant/workspace?*", async (route) => {
      const url = new URL(route.request().url());
      requests.push(url.searchParams.get("allTrips"));
      const fetchUrl = new URL(url); fetchUrl.searchParams.delete("conversation");
      const response = await route.fetch({ url: fetchUrl.href });
      const data = await response.json(); trips = data.trips;
      const conversations = trips.slice(0, 2).map((trip, i) => ({ id: `00000000-0000-4000-8000-00000000000${i + 1}`, title: `Hội thoại kiểm thử ${i + 1}`, tripSlug: trip.slug, tripTitle: trip.title, updatedAt: "2026-09-05T10:00:00Z", status: "completed" }));
      data.conversations = conversations; data.historyCursor = null;
      data.selectedConversation = conversations.find((item) => item.id === url.searchParams.get("conversation")) || null;
      data.turns = []; data.nextCursor = null;
      await route.fulfill({ response, json: data });
    });
    await gotoHealthy(page, "/?chat=1");
    await expect(page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" })).toBeEnabled();
    expect(trips.length).toBeGreaterThanOrEqual(2);
    const trigger = page.getByRole("button", { name: "Lịch sử", exact: true, includeHidden: true });
    const frame = page.getByRole("region", { name: "Trợ lý hành trình", exact: true, includeHidden: true });
    await trigger.click();
    const sidebar = page.getByRole("dialog", { name: "Lịch sử trò chuyện" });
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole("button", { name: /Hội thoại kiểm thử 2/ })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await settle(page);
    const frameBox = await frame.boundingBox(), sideBox = await sidebar.boundingBox();
    expect(Math.abs(sideBox.x - frameBox.x)).toBeLessThan(2);
    expect(sideBox.width).toBeLessThanOrEqual(280);
    expect(frameBox.width - sideBox.width).toBeGreaterThanOrEqual(44);
    expect((await sidebar.getByRole("heading").boundingBox()).width).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("panel-history.png"), fullPage: false });
    await page.getByRole("button", { name: /Hội thoại kiểm thử 2/ }).click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("combobox", { name: "Chuyến đi", exact: true })).toHaveValue(trips[1].slug);
    await expect(sidebar).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(requests.every((value) => value === "1")).toBe(true);
    const events = await page.evaluate(() => window.assistantMotion);
    expect(events.some((event) => event.name.includes("history-in"))).toBe(true);
    expect(events.some((event) => event.name.includes("history-out"))).toBe(true);
    await gotoHealthy(page, "/assistant");
    await expect(page.getByRole("link", { name: "Thu nhỏ", exact: true })).toBeVisible();
    await trigger.click();
    await expect(page.getByRole("navigation", { name: "Lịch sử trò chuyện" })).toBeVisible();
    await settle(page);
    if (viewport.width >= 900) {
      await expect(page.getByRole("dialog", { name: "Lịch sử trò chuyện" })).toHaveCount(0);
      const dock = await page.getByRole("complementary", { name: "Hội thoại", exact: true }).boundingBox();
      expect(dock.width).toBe(260);
      expect((await trigger.boundingBox()).x).toBeGreaterThanOrEqual(dock.x + dock.width);
      await page.getByRole("button", { name: /Hội thoại kiểm thử 1/ }).click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" })).toBeEnabled();
    }
    await settle(page);
    await page.screenshot({ path: testInfo.outputPath("expanded-history.png"), fullPage: false });
    await page.getByRole("button", { name: "Đóng lịch sử" }).press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  });
}

test("history changes between overlay and dock at 900px and handles rapid toggles", async ({ page }) => {
  await page.setViewportSize({ width: 899, height: 900 });
  await gotoHealthy(page, "/assistant");
  const trigger = page.getByRole("button", { name: "Lịch sử", exact: true, includeHidden: true });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Lịch sử trò chuyện" })).toBeVisible();
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.getByRole("complementary", { name: "Hội thoại", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Lịch sử trò chuyện" })).toHaveCount(0);
  await trigger.focus();
  await trigger.press("Enter"); await trigger.press("Enter"); await trigger.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await settle(page);
  await trigger.press("Enter");
  await expect(page.getByRole("navigation", { name: "Lịch sử trò chuyện" })).toBeVisible();
});

for (const [mode, width] of [["normal", 320], ["normal", 1440], ["normal", 1920], ["reduced", 1440], ["unsupported", 1440]]) {
  test(`assistant route and panel motion: ${mode} at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 760 : 900 });
    if (mode === "reduced") await page.emulateMedia({ reducedMotion: "reduce" });
    if (mode === "unsupported") await page.addInitScript(() => { document.startViewTransition = undefined; });
    await recordMotion(page);
    await gotoHealthy(page, "/");
    await page.getByRole("button", { name: /^Trợ lý/ }).click();
    const input = page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" });
    await expect(input).toBeEnabled();
    await input.fill("Bản nháp trong chuyển động");
    await settle(page);
    await page.getByRole("link", { name: "Mở rộng", exact: true }).click();
    await expect(page.getByRole("link", { name: "Thu nhỏ", exact: true })).toBeVisible();
    await expect(input).toHaveValue("Bản nháp trong chuyển động");
    await settle(page);
    await page.getByRole("link", { name: "Thu nhỏ", exact: true }).click();
    await expect(page.getByRole("link", { name: "Mở rộng", exact: true })).toBeVisible();
    await expect(input).toHaveValue("Bản nháp trong chuyển động");
    await settle(page);
    await page.getByRole("button", { name: "Đóng", exact: true }).click();
    await expect(page.getByRole("region", { name: "Trợ lý hành trình", exact: true, includeHidden: true })).toHaveCount(0);
    await settle(page);
    const events = await page.evaluate(() => window.assistantMotion);
    if (mode === "normal") {
      expect(events.some((event) => event.name === "assistant-panel-in"), JSON.stringify(events)).toBe(true);
      expect(events.some((event) => event.name.includes("panel-close")), JSON.stringify(events)).toBe(true);
      expect(events.filter((event) => event.pseudo?.includes("view-transition-group(trip-assistant)") && event.duration === "0.28s").length, JSON.stringify(events)).toBeGreaterThanOrEqual(2);
    } else if (mode === "reduced") {
      expect(events.filter((event) => event.pseudo?.includes("view-transition")).every((event) => parseFloat(event.duration) <= .001), JSON.stringify(events)).toBe(true);
    } else expect(events.some((event) => event.pseudo?.includes("view-transition"))).toBe(false);
  });
}


test("closing during a pending load stays closed and can immediately reopen", async ({ page }) => {
  let release, started;
  const held = new Promise((resolve) => { release = resolve; });
  const requested = new Promise((resolve) => { started = resolve; });
  await page.route("**/api/v1/assistant/workspace?*", async (route) => {
    const response = await route.fetch(); started(); await held;
    await route.fulfill({ response }).catch(() => {});
  });
  await gotoHealthy(page, "/?chat=1");
  await requested;
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(page.getByRole("region", { name: "Trợ lý hành trình", exact: true })).toHaveCount(0);
  release();
  await page.unrouteAll({ behavior: "wait" });
  expect(new URL(page.url()).searchParams.has("chat")).toBe(false);
  const launcher = page.getByRole("button", { name: /^Trợ lý/ });
  await launcher.click();
  await expect(page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" })).toBeEnabled();
  await settle(page);
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  await launcher.click();
  await expect(page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" })).toBeEnabled();
  await settle(page);
  expect(new URL(page.url()).searchParams.get("chat")).toBe("1");
});
