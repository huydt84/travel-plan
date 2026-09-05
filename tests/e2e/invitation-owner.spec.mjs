import { expect, gotoHealthy, test } from "./fixtures.mjs";

test("owner opens the composer directly without an approval route", async ({ page }) => {
  await gotoHealthy(page, "/");
  const inviteButton = page.getByRole("button", { name: "Rủ bạn đi cùng", exact: true });

  await inviteButton.click();

  const dialog = page.getByRole("dialog", { name: /Rủ bạn đi/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("list", { name: "Tiến trình mở quyền gửi lời rủ" })).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: /Email người bạn muốn rủ/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Gửi 0 lời rủ" })).toBeDisabled();

  await dialog.getByRole("button", { name: "Đóng lời rủ" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(inviteButton).toBeFocused();
});

test("invitation deep link opens once and cleans callback parameters", async ({ page }) => {
  await gotoHealthy(page, "/?invite=1&gmail=return");

  await expect(page.getByRole("dialog", { name: /Rủ bạn đi/ })).toBeVisible();
  await expect(page).not.toHaveURL(/(?:invite|gmail)=/);
  await expect(page.getByText("Gmail đã kết nối — kiểm tra lại trước khi gửi.")).toBeVisible();
});

test("mobile invitation dialog closes with Escape and restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHealthy(page, "/");
  const inviteButton = page.getByRole("button", { name: "Rủ bạn đi cùng", exact: true });

  await inviteButton.click();
  await expect(page.getByRole("dialog", { name: /Rủ bạn đi/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog", { name: /Rủ bạn đi/ })).toHaveCount(0);
  await expect(inviteButton).toBeFocused();
});

test("owner invitation access contract is available to the sheet", async ({ page, request }) => {
  await gotoHealthy(page, "/");
  const tripSlug = await page.getByRole("combobox", { name: "Chọn chuyến đi" }).inputValue();

  const response = await request.get(`/api/invitation-access?tripSlug=${encodeURIComponent(tripSlug)}`);
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    authState: "authenticated",
    isOwner: true,
    permission: { status: "approved" },
    gmailAuthorized: true,
    trip: { slug: tripSlug },
  });
});

test("mobile owner opens management from the account disclosure", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHealthy(page, "/");

  await expect(page.locator(".desktop-manage-link")).toBeHidden();
  const accountButton = page.getByRole("button", { name: /Mở menu tài khoản/ });
  await accountButton.click();

  const accountGroup = page.getByRole("group", { name: "Tài khoản" });
  await expect(accountGroup.getByRole("link", { name: "Quản lý", exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(accountGroup).toHaveCount(0);
  await expect(accountButton).toBeFocused();
});

test("invitation permission states gate the composer and recover after access errors", async ({ page, runtimeHealth }, testInfo) => {
  let permission = null;
  let fail = true;
  await page.route("**/api/invitation-access?*", async (route) => {
    if (fail) return route.fulfill({ status: 400, json: { error: "Temporary access failure" } });
    return route.fulfill({ json: { authState: "authenticated", isOwner: false, permission, gmailAuthorized: false, quota: { batchesRemaining: 20 }, history: [] } });
  });
  await page.route("**/api/invitation-access/requests", async (route) => {
    permission = { status: "pending", requestedTripTitle: "Sample trip", requestedAt: new Date().toISOString() };
    await route.fulfill({ json: permission });
  });
  await page.setViewportSize({ width: 320, height: 760 });
  await gotoHealthy(page, "/");
  const trigger = page.getByRole("button", { name: "Rủ bạn đi cùng", exact: true });
  await trigger.click();
  await expect(page.getByText("Không tải được quyền gửi lời rủ", { exact: true })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Thử tải lại" }).click();
  await expect(page.locator("#invite-email")).toHaveCount(0);
  await page.getByRole("button", { name: "Yêu cầu quyền gửi lời rủ" }).click();
  await expect(page.getByRole("heading", { name: "Đã gửi yêu cầu" })).toBeVisible();
  await expect(page.locator("#invite-email")).toHaveCount(0);
  permission = { ...permission, status: "approved" };
  await page.getByRole("button", { name: "Kiểm tra lại" }).click();
  await expect(page.locator("#invite-email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tiếp tục với Google" })).toBeDisabled();
  await page.locator("#invite-email").fill("friend@example.com");
  await page.getByRole("button", { name: "Thêm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tiếp tục với Google" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("approved-gmail-consent.png"), fullPage: true });
  await page.keyboard.press("Escape");
  for (const [status, heading] of [["denied", "Yêu cầu chưa được chấp thuận"], ["revoked", "Quyền gửi lời rủ đã bị thu hồi"]]) {
    permission = { ...permission, status, decisionReason: "Review needed" };
    await trigger.click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.locator("#invite-email")).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  runtimeHealth.splice(0, runtimeHealth.length, ...runtimeHealth.filter((message) => !message.includes("400")));
});

test("Gmail return restores the edited draft and focus remains inside the invitation", async ({ page }) => {
  await gotoHealthy(page, "/");
  const slug = await page.getByRole("combobox", { name: "Chọn chuyến đi" }).inputValue();
  await page.evaluate(({ slug }) => sessionStorage.setItem(`travel-plan:invite:local-admin@localhost.invalid:${slug}`, JSON.stringify({ savedAt: Date.now(), recipients: ["friend@example.com"], subject: "Edited subject", message: "Edited message", draftTouched: true })), { slug });
  await gotoHealthy(page, `/?trip=${slug}&invite=1&gmail=return`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Tiêu đề", { exact: true })).toHaveValue("Edited subject");
  await expect(dialog.getByLabel(/Nội dung/)).toHaveValue("Edited message");
  await expect(dialog.getByRole("button", { name: "Gửi 1 lời rủ" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Đóng lời rủ" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Gửi 1 lời rủ" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Đóng lời rủ" })).toBeFocused();
});
