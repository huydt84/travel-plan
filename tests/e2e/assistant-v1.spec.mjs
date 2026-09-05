import { expect, gotoHealthy, test } from "./fixtures.mjs";

test("assistant persists a turn, stages a complete diff, and applies only after explicit confirmation", async ({ page }) => {
  const ready = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/assistant/workspace" && response.ok());
  await gotoHealthy(page, "/v1");
  await ready;
  await expect(page.getByRole("heading", { level: 1, name: "Trợ lý hành trình" })).toBeVisible();

  await expect(page.getByLabel("Yêu cầu cho trợ lý")).toBeEnabled();
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))));
  const request = "Cập nhật hoạt động đầu tiên với một ghi chú thử nghiệm";
  await page.getByLabel("Yêu cầu cho trợ lý").fill(request);
  await page.getByRole("button", { name: "Gửi yêu cầu" }).click();
  await expect(page.getByText("Tôi đã chuẩn bị một thay đổi", { exact: false }).last()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /Xem 1 thay đổi/ }).last().click();
  await expect(page.getByRole("heading", { name: "1 thay đổi được đề xuất" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Áp dụng 1 thay đổi" })).toBeEnabled();

  await page.getByRole("button", { name: "Áp dụng 1 thay đổi" }).click();
  await expect(page.getByText("Đã cập nhật lịch")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Mở lịch hiện tại" })).toBeVisible();

  await page.reload();
  await expect(page.getByText(request).last()).toBeVisible();
  await page.getByRole("button", { name: "Xem thay đổi đã áp dụng" }).last().click();
  await expect(page.getByText("Đã cập nhật lịch").last()).toBeVisible();
});

test("v1 transport rejects a confirmation request without same-origin browser context", async ({ request }) => {
  const response = await request.post("/api/v1/assistant/proposals/00000000-0000-4000-8000-000000000000/confirm", {
    data: { confirmationToken: "x".repeat(40) },
  });
  expect(response.status()).toBe(403);
  expect((await response.json()).code).toBe("ORIGIN_FORBIDDEN");
});
