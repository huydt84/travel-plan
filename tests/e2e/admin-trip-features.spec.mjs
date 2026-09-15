import { expect, gotoHealthy, test } from "./fixtures.mjs";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";

test("admin manages picnic activities, optional details, source CRUD, and visible slugs", async ({ page, request }) => {
  const runId = Date.now();
  const activityTitle = `E2E picnic ${runId}`;
  const sourceTitle = `E2E source ${runId}`;
  const updatedSourceTitle = `${sourceTitle} updated`;
  const slug = `admin-features-${runId}`;
  let activityId;
  let sourceNumber;

  try {
    expect((await request.post("/api/trips", { data: { slug, title: "Admin features", startDate: "2030-04-01", endDate: "2030-04-01", timezone: "Asia/Tokyo", location: "Kyoto" } })).status()).toBe(201);
    await gotoHealthy(page, `/admin/trips?trip=${slug}`);
    await expect(page.locator(".trip-list-item.active code")).toHaveText(slug);
    await expect(page.locator(".plan-summary .plan-slug")).toHaveText(slug);

    await page.getByRole("button", { name: "Thêm hoạt động", exact: true }).click();
    const activityForm = page.locator(".schedule-create-editor");
    await activityForm.getByLabel("Bắt đầu", { exact: true }).fill("23:50");
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
    await request.delete(`/api/trips/${slug}`);
  }
});

for (const [width, height] of [[320, 760], [1440, 900], [1920, 1080]]) test(`admin can see and CRUD assistant-saved places at ${width}`, async ({ page, request }, testInfo) => {
  const runId = Date.now();
  const slug = `admin-places-${runId}`;
  const assistantPlaceName = `Assistant place ${runId}`;
  const updatedPlaceName = `${assistantPlaceName} updated`;
  const createdPlaceName = `Manual place ${runId}`;
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);

  try {
    expect((await request.post("/api/trips", { data: { slug, title: "Admin places", startDate: "2030-04-01", endDate: "2030-04-01", timezone: "Asia/Tokyo", location: "Kyoto" } })).status()).toBe(201);
    const [trip] = await sql`SELECT id FROM trips WHERE slug=${slug}`;
    await sql`INSERT INTO saved_places(trip_id,name,address,latitude,longitude,website,google_place_id,notes)
      VALUES(${trip.id},${assistantPlaceName},'Kyoto, Japan',35.0116,135.7681,'https://example.com/place','assistant-google-id','Created by the assistant')`;

    await page.setViewportSize({ width, height });
    await gotoHealthy(page, `/admin/trips?trip=${slug}`);
    const places = page.getByRole("region", { name: "Địa điểm đã lưu" });
    await expect(places.getByRole("heading", { name: assistantPlaceName })).toBeVisible();
    await places.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`saved-places-${width}.png`), fullPage: true });

    await places.getByRole("button", { name: "Sửa" }).click();
    const editForm = places.getByRole("form", { name: `Sửa ${assistantPlaceName}` });
    await editForm.getByLabel("Tên địa điểm").fill(updatedPlaceName);
    await editForm.getByRole("button", { name: "Lưu địa điểm" }).click();
    await expect(places.getByRole("heading", { name: updatedPlaceName })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await places.locator("article", { hasText: updatedPlaceName }).getByRole("button", { name: "Xoá" }).click();
    await expect(places.getByRole("heading", { name: updatedPlaceName })).toHaveCount(0);

    await places.getByRole("button", { name: "Thêm địa điểm" }).click();
    const createForm = places.getByRole("form", { name: "Thêm địa điểm" });
    await createForm.getByLabel("Tên địa điểm").fill(createdPlaceName);
    await createForm.getByLabel("Địa chỉ").fill("Gion, Kyoto");
    await createForm.getByRole("button", { name: "Thêm địa điểm" }).click();
    await expect(places.getByRole("heading", { name: createdPlaceName })).toBeVisible();

    const plan = await (await request.get(`/api/trips/${encodeURIComponent(slug)}`)).json();
    expect(plan.places).toEqual([expect.objectContaining({ name: createdPlaceName, address: "Gion, Kyoto" })]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  } finally {
    await request.delete(`/api/trips/${slug}`);
    await sql.end();
  }
});
