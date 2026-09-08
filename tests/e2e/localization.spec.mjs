import { itineraryTest as test, expect, gotoHealthy } from "./fixtures.mjs";

test.describe("localization", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("keeps Vietnamese as the default and persists English and Japanese", async ({ page, tripSlug }) => {
    await gotoHealthy(page, `/?trip=${tripSlug}`);
    const selector = page.getByTestId("language-switcher");

    await expect(selector).toHaveValue("vi");
    await expect(selector.locator("option")).toHaveText(["Tiếng Việt", "English", "日本語"]);
    await expect(page.locator("html")).toHaveAttribute("lang", "vi");

    await selector.selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByText("Full schedule", { exact: true })).toBeVisible();

    await page.reload();
    await expect(selector).toHaveValue("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await selector.selectOption("ja");
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page.getByText("すべての予定", { exact: true })).toBeVisible();
    await gotoHealthy(page, "/requests");
    await expect(page.getByTestId("language-switcher")).toHaveValue("ja");
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    const response = await page.request.get("/requests");
    expect(await response.text()).toMatch(/<html[^>]*lang="ja"/);
  });

  test("reopened notification uses a status label and preserves authored text", async ({ page }) => {
    await page.route("**/api/notifications?**", (route) => route.fulfill({ json: {
      notifications: [{ id: "locale-status", type: "contribution_status_changed", actor: { name: "Alex" },
        contribution: { status: "open", activityTitle: "京都の散歩" }, trip: { title: "旅の記録" },
        createdAt: new Date().toISOString(), readAt: null, targetUrl: "/" }], unreadCount: 1, nextCursor: null,
    } }));
    await gotoHealthy(page, "/");
    await page.getByTestId("language-switcher").selectOption("en");
    await page.getByRole("button", { name: /Open notifications/ }).click();
    await expect(page.getByText("Your feedback: Reopened", { exact: true })).toBeVisible();
    await expect(page.getByText("Alex changed the status of your feedback.", { exact: true })).toBeVisible();
    await expect(page.getByText("旅の記録 · 京都の散歩", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("language-switcher").selectOption("ja");
    await page.getByRole("button", { name: /通知を開く/ }).click();
    await expect(page.getByText("あなたのコメント：再開", { exact: true })).toBeVisible();
  });
});
