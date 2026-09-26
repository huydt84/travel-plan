import { expect, test } from "@playwright/test";

const sizes = [[320, 760], [1440, 900], [1920, 1080]];

test("persona switcher changes identity without carrying the previous trip visibility", async ({ page, context }) => {
  await page.goto("/dev/personas");
  await expect(page.getByRole("heading", { name: "Chọn góc nhìn kiểm thử" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Đang sử dụng" })).toBeVisible();

  await page.getByRole("button", { name: "Test với Anonymous" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Lịch trình riêng của nhóm bạn" })).toBeVisible();
  const cookie = (await context.cookies()).find((item) => item.name === "travel-plan-local-persona");
  expect(cookie).toMatchObject({ value: "anonymous", httpOnly: true, sameSite: "Lax", path: "/" });

  await page.goto("/dev/personas");
  await expect(page.getByRole("button", { name: "Đang sử dụng" })).toBeVisible();
  await page.getByRole("button", { name: "Test với Local Member" }).click();
  await expect(page).toHaveURL(/\/?(?:\?.*)?$/);
  await expect(page.getByRole("combobox", { name: /Chọn chuyến đi/ })).toHaveAttribute("data-trip-slug", "local-permission-lab");
  await expect(page.getByRole("link", { name: /Quản lý chuyến/ })).toHaveCount(0);
});

for (const [width, height] of sizes) {
  test(`persona page is readable without horizontal overflow at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/dev/personas");
    await expect(page.getByRole("heading", { name: "Danh sách persona" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: `test-results/personas-${width}x${height}.png`, fullPage: true });
  });
}
