import { expect, gotoHealthy, test } from "./fixtures.mjs";

// Presentation-only fixtures keep visual QA independent of model output and trip writes.
for (const viewport of [{ width: 320, height: 760 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`assistant visual states at ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    let state = "empty";
    await page.route("**/api/v1/assistant/workspace?*", async (route) => {
      const fixtureUrl = new URL(route.request().url());
      fixtureUrl.searchParams.delete("conversation");
      const response = await route.fetch({ url: fixtureUrl.href });
      const workspace = await response.json();
      const conversation = { id: "00000000-0000-4000-8000-000000000001", title: "Chuẩn bị chuyến đi Odaiba", tripSlug: workspace.selectedTripSlug, updatedAt: "2026-09-05T10:00:00Z", status: "completed" };
      workspace.selectedConversation = state === "empty" ? null : conversation;
      workspace.conversations = [conversation];
      workspace.nextCursor = null;
      workspace.historyCursor = null;
      workspace.turns = state === "empty" ? [] : [{
        id: "00000000-0000-4000-8000-000000000002", input: "Kiểm tra lịch trình và đề xuất thêm thời gian di chuyển.",
        status: state === "failed" ? "failed" : "completed", errorCode: state === "failed" ? "PROVIDER_ERROR" : null,
        output: "### Thời gian di chuyển\n\nBạn nên dành thêm **15 phút** giữa hai hoạt động để cả nhóm di chuyển thoải mái. [E1]\n\n| Hoạt động | Dự kiến |\n| --- | --- |\n| Đi bộ đến bến tàu | 15 phút |\n| Nghỉ và chụp ảnh | 20 phút |",
        citations: [{ id: "E1", title: "Hướng dẫn di chuyển và giờ hoạt động tại Odaiba", publisher: "Nguồn minh họa kiểm thử", url: "https://example.com/odaiba", checkedAt: "2026-09-05T10:00:00Z" }],
        changeSet: { id: "visual-proposal", status: "staged", confirmationToken: "visual-only", baseRevision: 1, expiresAt: "2099-09-05T10:00:00Z", digest: "visual-only-digest", preview: { summary: "1 thay đổi được đề xuất", changes: [{ kind: "activity.update", targetKey: "transfer", title: "Di chuyển đến bến tàu", before: { detail: "Di chuyển theo lịch ban đầu" }, after: { detail: "Dành thêm 15 phút để đi bộ và tập trung cả nhóm tại bến tàu." } }], warnings: [] } },
      }];
      await route.fulfill({ response, json: workspace });
    });
    const capture = async (name) => {
      await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))));
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false });
    };
    await gotoHealthy(page, "/?chat=1");
    await expect(page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" })).toBeEnabled();
    await capture("companion-empty");
    await page.getByRole("link", { name: "Mở rộng", exact: true }).click();
    await expect(page.getByRole("link", { name: "Lịch trình", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cùng lên một chuyến đi vừa ý hơn." })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" })).toBeEnabled();
    await capture("expanded-empty");
    state = "completed";
    await page.getByRole("button", { name: "Lịch sử", exact: true }).click();
    await page.getByRole("button", { name: /Chuẩn bị chuyến đi Odaiba/ }).click();
    await expect(page.getByRole("heading", { name: "Thời gian di chuyển" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Thời gian di chuyển" }).locator("..")).toHaveCSS("font-size", "16px");
    if (await page.getByRole("button", { name: "Lịch sử", exact: true }).getAttribute("aria-expanded") === "true") await page.getByRole("button", { name: "Lịch sử", exact: true }).click();
    await capture("response");
    await page.getByRole("button", { name: "Nguồn · 1" }).click();
    await expect(page.getByRole("dialog", { name: "Nguồn tham khảo" })).toBeVisible();
    await capture("sources");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Nguồn · 1" })).toBeFocused();
    await page.getByRole("button", { name: /Xem 1 thay đổi/ }).click();
    await expect(page.getByRole("button", { name: "Áp dụng 1 thay đổi" })).toBeVisible();
    await capture("proposal");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Lịch sử", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Lịch sử trò chuyện" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Chuẩn bị chuyến đi Odaiba/ })).toBeVisible();
    await capture("history");
    await page.keyboard.press("Escape");
    state = "failed";
    // Clear the synthetic conversation from the URL before server rendering.
    await gotoHealthy(page, "/assistant");
    await expect(page.getByRole("button", { name: "Thử lại", exact: true })).toBeVisible();
    await capture("failed");
    await page.setExtraHTTPHeaders({ "x-local-viewer-email": "visual-member@localhost.invalid" });
    await gotoHealthy(page, "/assistant");
    await expect(page.getByRole("button", { name: "Đăng xuất", exact: true })).toBeVisible();
    await capture("access");

    for (const locale of [
      { value: "vi", title: "Trợ lý hành trình", action: "Đăng xuất" },
      { value: "en", title: "Trip assistant", action: "Sign out" },
      { value: "ja", title: "旅のアシスタント", action: "ログアウト" },
    ]) {
      await page.getByTestId("language-switcher").selectOption(locale.value);
      await expect(page.getByRole("heading", { level: 1, name: locale.title })).toBeVisible();
      await expect(page.getByRole("button", { name: locale.action, exact: true })).toBeVisible();

      const accessLayout = await page.locator("main").evaluate((main) => {
        const utilities = main.querySelector("section > header");
        const back = utilities.querySelector("a").getBoundingClientRect();
        const language = utilities.querySelector("select").getBoundingClientRect();
        const heading = main.querySelector("h1");
        const paragraph = main.querySelector("section > div > p");
        const action = main.querySelector("section > div > button");
        const headingBox = heading.getBoundingClientRect();
        const paragraphBox = paragraph.getBoundingClientRect();
        const actionBox = action.getBoundingClientRect();
        const headingLineHeight = Number.parseFloat(getComputedStyle(heading).lineHeight);
        const tabbables = [...main.querySelectorAll("a[href], select, button:not([disabled])")]
          .filter((element) => {
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          })
          .map((element) => element.tagName.toLowerCase());
        return {
          controlsOverlap: back.right > language.left || language.right > innerWidth,
          headingLines: Math.round(headingBox.height / headingLineHeight),
          contentInViewport: headingBox.top >= 0 && paragraphBox.bottom <= innerHeight && actionBox.bottom <= innerHeight,
          actionWraps: action.scrollWidth > action.clientWidth,
          actionSize: { width: actionBox.width, height: actionBox.height },
          languageSize: { width: language.width, height: language.height },
          tabbables,
        };
      });

      expect(accessLayout.controlsOverlap, `${locale.value} access utilities must not overlap`).toBe(false);
      expect(accessLayout.headingLines, `${locale.value} access heading must stay within two lines`).toBeLessThanOrEqual(2);
      expect(accessLayout.contentInViewport, `${locale.value} access content must fit the initial viewport`).toBe(true);
      expect(accessLayout.actionWraps, `${locale.value} access action must stay on one line`).toBe(false);
      expect(accessLayout.tabbables.slice(0, 3), `${locale.value} access tab order`).toEqual(["a", "select", "button"]);
      await page.locator("main section header a").focus();
      await expect(page.locator("main section header a")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByTestId("language-switcher")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.locator("main section > div > button")).toBeFocused();
      if (viewport.width === 320) {
        expect(accessLayout.actionSize.height).toBeGreaterThanOrEqual(44);
        expect(accessLayout.languageSize.width).toBeGreaterThanOrEqual(44);
        expect(accessLayout.languageSize.height).toBeGreaterThanOrEqual(44);
      }
    }
  });
}
