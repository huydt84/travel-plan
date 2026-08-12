import { expect, gotoHealthy, test } from "./fixtures.mjs";

test("owner can navigate all admin responsibilities without a full-page failure", async ({ page }) => {
  await gotoHealthy(page, "/admin/trips");
  const adminNav = page.getByRole("navigation", { name: "Khu vực quản lý" });

  await adminNav.getByRole("link", { name: /Lời rủ/ }).click();
  await expect(page).toHaveURL(/\/admin\/invitations$/);
  await expect(page.getByRole("heading", { level: 2, name: "Quyền gửi lời rủ" })).toBeVisible();

  await page.getByRole("link", { name: /Lịch sử gửi/ }).click();
  await expect(page).toHaveURL(/\/admin\/invitations\?view=history$/);
  await expect(page.getByRole("heading", { level: 2, name: "Lịch sử gửi" })).toBeVisible();

  await adminNav.getByRole("link", { name: "Người dùng" }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole("heading", { level: 1, name: "Người dùng" })).toBeVisible();

  await page.getByRole("link", { name: "Lịch trình" }).click();
  await expect(page).toHaveURL(/\/admin\/trips$/);
  await expect(page.getByRole("heading", { level: 1, name: "Quản lý lịch" })).toBeVisible();
});

test("invitation admin tabs preserve URL-backed state after reload", async ({ page }) => {
  await gotoHealthy(page, "/admin/invitations?view=history");

  await expect(page.getByRole("link", { name: /Lịch sử gửi/ })).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(page.getByRole("link", { name: /Lịch sử gửi/ })).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: /Yêu cầu quyền/ }).click();
  await expect(page).toHaveURL(/\/admin\/invitations$/);
  await expect(page.getByRole("link", { name: /Yêu cầu quyền/ })).toHaveAttribute("aria-current", "page");
});
