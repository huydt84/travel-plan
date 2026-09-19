import { expect, gotoHealthy, itineraryTest } from "./fixtures.mjs";

itineraryTest("owner can maintain activities from the normal schedule", async ({ page, request, tripSlug }) => {
  await gotoHealthy(page, `/?trip=${tripSlug}`);

  const originalTitle = "Khám phá khu phố cổ và các điểm tham quan Kyoto";
  const updatedTitle = "Kyoto buổi sáng đã cập nhật";
  const originalRow = page.locator(".timeline-item").filter({
    has: page.getByRole("heading", { level: 3, name: originalTitle }),
  });
  await originalRow.getByRole("button", { name: "Sửa", exact: true }).click();
  const editForm = originalRow.locator("form");
  await expect(editForm.getByRole("heading", { name: `Sửa: ${originalTitle}` })).toBeFocused();
  await editForm.getByLabel("Tiêu đề").fill(updatedTitle);
  await editForm.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(page.getByRole("heading", { level: 3, name: updatedTitle })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu thay đổi hoạt động." })).toBeVisible();

  await page.getByRole("button", { name: "Thêm vào ngày này" }).click();
  const createForm = page.locator("#schedule-editor-new");
  await createForm.getByLabel("Bắt đầu", { exact: true }).fill("12:00");
  await createForm.getByLabel("Kết thúc", { exact: true }).fill("13:00");
  await createForm.getByLabel("Tiêu đề").fill("Bữa trưa thử nghiệm");
  await createForm.getByRole("button", { name: "Thêm hoạt động" }).click();
  const createdRow = page.locator(".timeline-item").filter({
    has: page.getByRole("heading", { level: 3, name: "Bữa trưa thử nghiệm" }),
  });
  await expect(createdRow).toBeVisible();

  await createdRow.getByRole("button", { name: "Xoá", exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("Trip vẫn được giữ nguyên");
  await confirmation.getByRole("button", { name: "Xoá", exact: true }).click();
  await expect(page.getByRole("heading", { level: 3, name: "Bữa trưa thử nghiệm" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Chọn chuyến đi" })).toHaveAttribute("data-trip-slug", tripSlug);

  const plan = await (await request.get(`/api/itinerary?slug=${tripSlug}`)).json();
  expect(plan.itinerary.map((item) => item.title)).toContain(updatedTitle);
  expect(plan.itinerary.map((item) => item.title)).not.toContain("Bữa trưa thử nghiệm");
});

itineraryTest("members keep suggestion access without schedule management controls", async ({ page, request, tripSlug }) => {
  await page.setExtraHTTPHeaders({
    "x-local-viewer-email": "schedule-member@example.com",
    "x-local-viewer-name": "Schedule member",
  });
  await gotoHealthy(page, "/");
  expect((await request.post(`/api/trips/${tripSlug}/members`, {
    data: { email: "schedule-member@example.com" },
  })).status()).toBe(201);
  await gotoHealthy(page, `/?trip=${tripSlug}`);

  await expect(page.getByRole("button", { name: "Thêm vào ngày này" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sửa", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Xoá", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Góp ý cho hoạt động này" }).first()).toBeVisible();
});
