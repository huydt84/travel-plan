import { expect, gotoHealthy, itineraryTest as test } from "./fixtures.mjs";
import { randomUUID } from "node:crypto";

test("a deleted or inaccessible conversation is a not-found page, not a server failure", async ({ request }) => {
  expect((await request.get(`/assistant?conversation=${randomUUID()}`)).status()).toBe(404);
});

test("assistant persists a turn, stages a complete diff, and applies only after explicit confirmation", async ({ page, tripSlug }) => {
  const ready = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/assistant/workspace" && response.ok());
  await gotoHealthy(page, `/assistant?trip=${tripSlug}`);
  await ready;
  await expect(page.getByRole("heading", { level: 1, name: "Trợ lý hành trình" })).toBeVisible();

  await expect(page.getByLabel("Yêu cầu cho trợ lý")).toBeEnabled();
  await page.getByRole("button", { name: "Thêm chuyến đi này" }).click();
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))));
  const request = "Cập nhật hoạt động đầu tiên với một ghi chú thử nghiệm";
  await page.getByLabel("Yêu cầu cho trợ lý").fill(request);
  await page.getByRole("button", { name: "Gửi yêu cầu" }).click();
  await expect(page.getByRole("heading", { name: "Cần phê duyệt" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Cần phê duyệt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Phê duyệt thay đổi" })).toBeEnabled();

  await page.getByRole("button", { name: "Phê duyệt thay đổi" }).click();
  await expect(page.getByText("Đã lưu toàn bộ nhóm thay đổi được phê duyệt.")).toBeVisible({ timeout: 20_000 });

  await page.reload();
  await expect(page.getByText(request).last()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tài nguyên đã lưu" })).toBeVisible();
});

test("v1 transport rejects a confirmation request without same-origin browser context", async ({ request }) => {
  const response = await request.post("/api/v1/assistant/proposals/00000000-0000-4000-8000-000000000000/confirm", {
    data: { confirmationToken: "x".repeat(40) },
  });
  expect(response.status()).toBe(403);
  expect((await response.json()).code).toBe("ORIGIN_FORBIDDEN");
});
