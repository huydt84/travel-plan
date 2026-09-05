import { expect, gotoHealthy, test } from "./fixtures.mjs";

for (const viewport of [{ width: 320, height: 760 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`expand and collapse keep chat and draft open at ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await gotoHealthy(page, "/?chat=1");
    const input = page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" });
    await expect(input).toBeEnabled();
    await input.fill("Bản nháp giữ nguyên khi mở rộng và thu nhỏ");
    const before = new URL(page.url());
    await page.getByRole("link", { name: "Mở rộng", exact: true }).click();
    await expect(input).toHaveValue("Bản nháp giữ nguyên khi mở rộng và thu nhỏ");
    const collapse = page.getByRole("link", { name: "Thu nhỏ", exact: true });
    await expect(collapse).toBeVisible();
    await collapse.click();
    await expect(page).toHaveURL(/\/\?.*chat=1/);
    await expect(input).toHaveValue("Bản nháp giữ nguyên khi mở rộng và thu nhỏ");
    expect(new URL(page.url()).searchParams.get("conversation")).toBe(before.searchParams.get("conversation"));
    expect(new URL(page.url()).searchParams.get("trip")).toBe(before.searchParams.get("trip"));
    await page.screenshot({ path: testInfo.outputPath("collapsed.png"), fullPage: false });
    if (viewport.width === 320) await expect(page.getByRole("separator", { name: "Độ rộng trợ lý" })).toHaveCount(0);
  });
}

for (const width of [1440, 1920]) {
  test(`desktop divider resizes, clamps and remembers at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 1080 });
    await gotoHealthy(page, "/?chat=1");
    const panel = page.getByRole("complementary", { name: "Trợ lý cho chuyến đi hiện tại" });
    const divider = page.getByRole("separator", { name: "Độ rộng trợ lý" });
    await expect(divider).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" })).toBeEnabled();
    await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))));
    const initial = (await panel.boundingBox()).width;
    const edge = await divider.boundingBox();
    await page.mouse.move(edge.x + edge.width / 2, 300);
    await expect(divider).toHaveCSS("cursor", "col-resize");
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 - 120, 300, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await panel.boundingBox()).width).toBe(initial + 120);
    const tracker = page.locator(".trip-bar");
    expect((await tracker.boundingBox()).x + (await tracker.boundingBox()).width).toBeLessThanOrEqual(width - initial - 120 + 1);
    await page.getByRole("link", { name: "Mở rộng", exact: true }).click();
    await page.getByRole("link", { name: "Thu nhỏ", exact: true }).click();
    await expect.poll(async () => (await panel.boundingBox()).width).toBe(initial + 120);
    await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))));
    const resizedEdge = await divider.boundingBox();
    await page.mouse.move(resizedEdge.x + resizedEdge.width / 2, 300);
    await page.mouse.down();
    await page.mouse.move(resizedEdge.x + resizedEdge.width / 2 - 40, 300);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect.poll(async () => (await panel.boundingBox()).width).toBe(initial + 120);
    await divider.focus();
    await divider.press("ArrowLeft");
    await expect.poll(async () => (await panel.boundingBox()).width).toBe(initial + 144);
    await page.reload();
    await expect.poll(async () => (await panel.boundingBox()).width).toBe(initial + 144);
    await divider.press("Home");
    await expect.poll(async () => (await panel.boundingBox()).width).toBe(360);
    await page.screenshot({ path: testInfo.outputPath("narrow-panel.png"), fullPage: false });
    await divider.press("End");
    await expect.poll(async () => (await panel.boundingBox()).width).toBe(Math.min(960, width - 640));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const title = page.locator(".station-copy h1");
    const titleBox = await title.boundingBox();
    const station = await page.locator(".now-station").boundingBox();
    expect(titleBox.x).toBeGreaterThanOrEqual(station.x);
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(station.x + station.width);
    expect(station.x + station.width).toBeLessThanOrEqual((await panel.boundingBox()).x);
    expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const countdown = page.locator(".countdown-wrap");
    if (await countdown.isVisible()) {
      const countdownBox = await countdown.boundingBox();
      const copyBox = await page.locator(".station-copy").boundingBox();
      expect(countdownBox.y).toBeGreaterThanOrEqual(copyBox.y + copyBox.height);
      expect(countdownBox.x + countdownBox.width).toBeLessThanOrEqual(station.x + station.width);
    }
    await page.screenshot({ path: testInfo.outputPath("wide-panel.png"), fullPage: false });
    await page.setViewportSize({ width: 1200, height: 900 });
    await expect.poll(async () => (await panel.boundingBox()).width).toBe(560);
    await page.setViewportSize({ width: 320, height: 760 });
    await expect(divider).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" })).toBeVisible();
    await page.setViewportSize({ width, height: 900 });
    await divider.press("Enter");
    await expect.poll(async () => (await panel.boundingBox()).width).toBe(initial);
  });
}
