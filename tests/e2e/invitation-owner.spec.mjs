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
