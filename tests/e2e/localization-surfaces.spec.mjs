import { itineraryTest as test, expect, gotoHealthy } from "./fixtures.mjs";
import { LOCALE_COOKIE, translate } from "../../lib/i18n.mjs";

const viewports = [
  { width: 320, height: 760 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

// These are interface labels, never authored trip titles or assistant messages.
const untranslatedLabels = new Set([
  "Quyền gửi lời rủ", "Lịch sử gửi", "Tìm người dùng", "Trạng thái", "Tất cả",
  "Tên", "Lần đầu đăng nhập", "Hoạt động gần nhất", "Quyền", "Cố định",
  "Thêm hoạt động", "Nguồn mới", "Sửa trip", "Trip mới", "Lưu hoạt động",
  "Tìm người hoặc địa điểm", "Tạo lịch mới", "Gắn lịch có sẵn", "Không thực hiện",
  "Chỉnh sửa", "Cài đặt chung", "Cách tính hạn mức", "Quản trị viên", "Hạn mức",
  "Mô hình và suy nghĩ", "Mức suy nghĩ", "Yêu cầu/ngày", "Yêu cầu/tuần",
  "Email người bạn muốn rủ", "Tiêu đề", "Nội dung", "Gửi 0 lời rủ",
]);

async function auditTranslatedSurface(page, viewport, testInfo, name, requireSelector = true) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => {}))));
  const visibleLabels = await page.locator("h1, h2, h3, th, label, legend, button").evaluateAll((elements) =>
    elements.filter((element) => element.checkVisibility()).map((element) => element.textContent.trim()));
  expect(visibleLabels.filter((label) => untranslatedLabels.has(label)), `${name}: untranslated interface labels`).toEqual([]);
  const geometry = await page.evaluate(() => {
    const visible = (element) => element.checkVisibility() && !element.closest('[inert], [aria-hidden="true"], .sr-only');
    const selectors = [...document.querySelectorAll('[data-testid="language-switcher"]')].filter(visible);
    return {
      width: document.documentElement.scrollWidth,
      selectors: selectors.map((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width, height: box.height };
      }),
      smallTargets: innerWidth === 320 ? [...document.querySelectorAll("button, select, input, textarea")].filter(visible)
        .filter((element) => { const rect = element.getBoundingClientRect(); return rect.width < 44 || rect.height < 44; })
        .map((element) => element.getAttribute("aria-label") || element.textContent.trim() || element.tagName) : [],
      clipped: [...document.querySelectorAll("h1,h2,h3,h4,button,select")].filter(visible)
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => element.getAttribute("aria-label") || element.textContent.trim()),
    };
  });
  expect.soft(geometry.width, `${name}: horizontal overflow`).toBe(viewport.width);
  expect.soft(geometry.clipped, `${name}: clipped text`).toEqual([]);
  expect.soft(geometry.smallTargets, `${name}: mobile controls below 44px`).toEqual([]);
  if (requireSelector) expect(geometry.selectors.length, `${name}: visible language selector`).toBeGreaterThan(0);
  for (const box of geometry.selectors) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(viewport.width);
  }
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
}

for (const locale of ["en", "ja"]) {
  for (const viewport of viewports) {
    test(`${locale} interface and responsive coverage at ${viewport.width}`, async ({ page, context, baseURL, tripSlug }, testInfo) => {
      const t = (key) => translate(locale, key);
      await context.addCookies([{ name: LOCALE_COOKIE, value: locale, url: baseURL }]);
      await page.setViewportSize(viewport);
      for (const [name, path, heading] of [
        ["admin-trips", `/admin/trips?trip=${tripSlug}`, "admin.tripManagement"],
        ["admin-users", "/admin/users", "admin.userActivity"],
        ["admin-requests", "/admin/requests", "requests.title"],
        ["invitation-permissions", "/admin/invitations", "invitationsExtra.permissionTitle"],
        ["invitation-history", "/admin/invitations?view=history", "invitationsExtra.history"],
        ["requests", "/requests", "requests.title"],
        ["assistant-management", "/admin/assistant", "nav.adminAssistant"],
        ["assistant", "/assistant", "assistant.title"],
        ["companion", `/?trip=${tripSlug}&chat=1`, "assistant.title"],
        ["tracker", `/?trip=${tripSlug}`, "tracker.fullSchedule"],
      ]) {
        await test.step(name, async () => {
          await gotoHealthy(page, path);
          if (heading) await expect(page.getByRole("heading", { name: t(heading), exact: true })).toBeVisible();
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          await expect(page.getByRole("combobox", { name: t("language.label"), exact: true }).last()).toHaveValue(locale);
          await auditTranslatedSurface(page, viewport, testInfo, name);
          if (name === "admin-trips") {
            await page.getByRole("button", { name: t("adminExtra.message042"), exact: true }).first().click();
            const editor = page.locator('form[id^="schedule-editor-"]');
            await expect(editor.getByRole("heading", { name: t("adminExtra.message202") })).toBeVisible();
            await expect(editor.locator('select').first()).toBeEnabled();
            await auditTranslatedSurface(page, viewport, testInfo, "activity-editor");
            await editor.getByRole("button", { name: t("adminExtra.message082"), exact: true }).first().click();
            await expect(editor).toHaveCount(0);
          }
          if (name === "assistant-management") {
            await page.getByRole("link", { name: t("assistantExtra.settings.shared"), exact: true }).click();
            await page.getByRole("link", { name: t("assistantExtra.edit"), exact: true }).click();
            const editor = page.getByRole("dialog");
            await expect(editor).toBeVisible();
            await expect(editor.locator("#mode-daily")).toBeVisible();
            await auditTranslatedSurface(page, viewport, testInfo, "assistant-settings", false);
            await page.keyboard.press("Escape");
            await expect(editor).toHaveCount(0);
          }
          if (name === "assistant") {
            const composer = page.getByRole("textbox", { name: t("assistant.request") });
            await expect(composer).toBeEnabled();
            await composer.fill("Giữ nguyên bản nháp · 日本語 · $&");
            await page.getByTestId("language-switcher").last().selectOption(locale === "en" ? "ja" : "en");
            await expect(page.locator("#assistant-message")).toHaveValue("Giữ nguyên bản nháp · 日本語 · $&");
            await page.getByTestId("language-switcher").last().selectOption(locale);
            await composer.fill("");
            await page.getByRole("button", { name: t("assistant.history"), exact: true }).click();
            await expect(page.getByRole("navigation", { name: t("assistant.conversationHistory") })).toBeVisible();
            await auditTranslatedSurface(page, viewport, testInfo, "assistant-history");
          }
          if (name === "tracker") {
            await page.getByRole("button", { name: t("nav.invite"), exact: true }).click();
            const dialog = page.getByRole("dialog");
            await expect(dialog.locator("#invite-email")).toBeVisible();
            const draft = await dialog.locator("textarea").inputValue();
            await dialog.getByTestId("language-switcher").selectOption(locale === "en" ? "ja" : "en");
            await expect(dialog.locator("textarea")).toHaveValue(draft);
            await dialog.getByTestId("language-switcher").selectOption(locale);
            await auditTranslatedSurface(page, viewport, testInfo, "invitation-dialog");
          }
        });
      }
    });
  }
}

test("language survives client navigation and browser history", async ({ page }) => {
  await gotoHealthy(page, "/admin/trips");
  await page.getByTestId("language-switcher").selectOption("en");
  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users/);
  await expect(page.getByRole("heading", { name: translate("en", "admin.userActivity"), exact: true })).toBeVisible();
  await expect(page.getByTestId("language-switcher")).toHaveValue("en");
  await page.getByTestId("language-switcher").selectOption("ja");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await page.goBack();
  await expect(page.getByTestId("language-switcher")).toHaveValue("ja");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await page.reload();
  await expect(page.getByTestId("language-switcher")).toHaveValue("ja");
  await expect(page).toHaveTitle("旅行スケジュール管理");
});
