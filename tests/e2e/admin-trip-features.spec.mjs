import { expect, gotoHealthy, test } from "./fixtures.mjs";

test("admin manages picnic activities, optional details, source CRUD, and visible slugs", async ({ page, request }) => {
  const runId = Date.now();
  const activityTitle = `E2E picnic ${runId}`;
  const sourceTitle = `E2E source ${runId}`;
  const updatedSourceTitle = `${sourceTitle} updated`;
  let slug;
  let activityId;
  let sourceNumber;

  try {
    await gotoHealthy(page, "/admin/trips");
    slug = (await page.locator(".trip-list-item.active code").textContent()).trim();
    await expect(page.locator(".trip-list-item.active code")).toHaveText(slug);
    await expect(page.locator(".plan-summary .plan-slug")).toHaveText(slug);

    await page.getByRole("button", { name: "Thêm hoạt động", exact: true }).click();
    const activityForm = page.locator(".schedule-create-editor");
    await activityForm.getByLabel("Bắt đầu").fill("23:50");
    await activityForm.getByLabel("Kết thúc", { exact: true }).fill("23:55");
    await activityForm.getByLabel("Loại").selectOption("Picnic");
    await expect(activityForm.getByLabel("Icon")).toHaveValue("🧺");
    await activityForm.getByLabel("Tiêu đề").fill(activityTitle);
    await expect(activityForm.getByLabel(/Chi tiết/)).not.toHaveAttribute("required");
    await activityForm.getByRole("button", { name: "Thêm hoạt động" }).click();
    await expect(page.getByRole("status")).toContainText("Đã thêm hoạt động mới");
    await expect(page.getByRole("heading", { name: activityTitle })).toBeVisible();

    let planResponse = await request.get(`/api/trips/${encodeURIComponent(slug)}`);
    let plan = await planResponse.json();
    activityId = plan.backbone.find((item) => item.title === activityTitle)?.id;
    expect(activityId).toBeTruthy();
    expect(plan.backbone.find((item) => item.id === activityId)).toMatchObject({ type: "Picnic", icon: "🧺", detail: "" });

    await page.getByRole("button", { name: "Thêm nguồn", exact: true }).click();
    const createSourceForm = page.locator(".source-form");
    await createSourceForm.getByLabel("Tên nguồn").fill(sourceTitle);
    await createSourceForm.getByLabel("URL").fill(`https://example.com/source-${runId}`);
    await createSourceForm.getByRole("button", { name: "Thêm nguồn" }).click();
    await expect(page.getByRole("status")).toContainText("Đã thêm nguồn");

    planResponse = await request.get(`/api/trips/${encodeURIComponent(slug)}`);
    plan = await planResponse.json();
    sourceNumber = plan.sources.find((source) => source.title === sourceTitle)?.number;
    expect(sourceNumber).toBeTruthy();

    const sourceRow = page.locator(".admin-source-item", { hasText: sourceTitle });
    await sourceRow.getByRole("button", { name: "Sửa" }).click();
    const editSourceForm = page.locator(".source-form");
    await expect(editSourceForm.getByRole("heading", { name: `Sửa nguồn ${sourceNumber}` })).toBeVisible();
    await editSourceForm.getByLabel("Tên nguồn").fill(updatedSourceTitle);
    await editSourceForm.getByLabel("URL").fill(`https://example.org/source-${runId}`);
    await editSourceForm.getByRole("button", { name: "Lưu nguồn" }).click();
    await expect(page.locator(".admin-source-item", { hasText: updatedSourceTitle })).toContainText("example.org");

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(".admin-source-item", { hasText: updatedSourceTitle }).getByRole("button", { name: "Xoá" }).click();
    await expect(page.locator(".admin-source-item", { hasText: updatedSourceTitle })).toHaveCount(0);
    sourceNumber = null;
  } finally {
    if (sourceNumber && slug) await request.delete(`/api/trips/${encodeURIComponent(slug)}/sources/${sourceNumber}`);
    if (activityId && slug) await request.delete(`/api/trips/${encodeURIComponent(slug)}/schedule/${activityId}`);
  }
});
