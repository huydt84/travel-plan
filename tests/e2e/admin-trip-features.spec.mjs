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
    await expect(activityForm.locator('[title="Bắt buộc"]')).toHaveCount(7);
    await expect(activityForm.getByText("Không bắt buộc", { exact: true })).toHaveCount(3);
    await activityForm.getByLabel("Bắt đầu", { exact: true }).fill("23:50");
    await activityForm.getByLabel("Kết thúc", { exact: true }).fill("23:55");
    for (const [type, icon] of [["Reservation", "📞"], ["Show", "🎭"], ["Festival", "🎉"], ["Relax", "🌿"], ["Break", "🪑"], ["Meet", "🤝"]]) {
      await activityForm.getByLabel("Loại").selectOption(type);
      await expect(activityForm.getByLabel("Icon")).toHaveValue(icon);
    }
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
    await expect(createSourceForm.locator('[title="Bắt buộc"]')).toHaveCount(2);
    await createSourceForm.getByLabel("Loại liên kết").selectOption("route");
    await createSourceForm.getByLabel("Tên nguồn").fill(sourceTitle);
    await createSourceForm.getByLabel("URL").fill(`https://example.com/source-${runId}`);
    await createSourceForm.getByRole("button", { name: "Thêm nguồn" }).click();
    await expect(page.getByRole("status")).toContainText("Đã thêm nguồn");

    planResponse = await request.get(`/api/trips/${encodeURIComponent(slug)}`);
    plan = await planResponse.json();
    sourceNumber = plan.sources.find((source) => source.title === sourceTitle)?.number;
    expect(sourceNumber).toBeTruthy();
    expect(plan.sources.find((source) => source.number === sourceNumber)?.kind).toBe("route");
    await expect(page.getByRole("heading", { name: "1 Tuyến đường" })).toBeVisible();
    await gotoHealthy(page, `/?trip=${slug}`);
    await expect(page.getByRole("heading", { name: "Tuyến đường" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(sourceTitle) })).toHaveAttribute("href", `https://example.com/source-${runId}`);
    await gotoHealthy(page, `/admin/trips?trip=${slug}`);

    const sourceRow = page.locator(".admin-source-item", { hasText: sourceTitle });
    await sourceRow.getByRole("button", { name: "Sửa" }).click();
    const editSourceForm = page.locator(".source-form");
    await expect(editSourceForm.getByRole("heading", { name: `Sửa nguồn ${sourceNumber}` })).toBeVisible();
    await editSourceForm.getByLabel("Tên nguồn").fill(updatedSourceTitle);
    await editSourceForm.getByLabel("Loại liên kết").selectOption("reference");
    await editSourceForm.getByLabel("URL").fill(`https://example.org/source-${runId}`);
    await editSourceForm.getByRole("button", { name: "Lưu nguồn" }).click();
    await expect(page.locator(".admin-source-item", { hasText: updatedSourceTitle })).toContainText("example.org");
    await expect(page.getByRole("heading", { name: "1 Nguồn tham khảo" })).toBeVisible();

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

test("booking activities can live outside the trip and reservation contacts remain editable", async ({ page, request }) => {
  const runId = Date.now();
  const slug = `booking-features-${runId}`;
  let reservationId;

  try {
    expect((await request.post("/api/trips", { data: { slug, title: "Booking features", startDate: "2030-04-10", endDate: "2030-04-12", timezone: "Asia/Tokyo", location: "Tokyo" } })).status()).toBe(201);
    const reservationResponse = await request.post(`/api/trips/${slug}/schedule`, { data: {
      startDate: "2030-04-01", start: "09:00", endDate: "2030-04-01", end: "09:30",
      title: "Reserve dinner", type: "Reservation", icon: "📞", detail: "", refs: [],
      reservationContacts: [{ name: "Long restaurant name for responsive layout", phone: "03-1234-5678", link: "https://example.com/book" }],
    } });
    expect(reservationResponse.status()).toBe(201);
    reservationId = (await reservationResponse.json()).id;
    expect((await request.post(`/api/trips/${slug}/schedule`, { data: {
      startDate: "2030-03-20", start: "10:00", endDate: "2030-03-20", end: "10:15",
      title: "Book flight", type: "FlightBooking", icon: "✈️", detail: "", refs: [], reservationContacts: [],
    } })).status()).toBe(201);
    expect((await request.post(`/api/trips/${slug}/schedule`, { data: {
      startDate: "2030-04-01", start: "12:00", endDate: "2030-04-01", end: "13:00",
      title: "Outside visit", type: "Visit", icon: "📍", detail: "", refs: [], reservationContacts: [],
    } })).status()).toBe(400);
    expect((await request.patch(`/api/trips/${slug}`, { data: {
      startDate: "2030-05-10", endDate: "2030-05-12",
    } })).status()).toBe(200);

    await gotoHealthy(page, `/admin/trips?trip=${slug}`);
    const row = page.locator(".admin-schedule-item", { has: page.getByRole("heading", { name: "Reserve dinner" }) });
    await row.getByRole("button", { name: "Sửa" }).click();
    const form = row.locator(".schedule-inline-editor");
    await expect(form.getByText("Mục đặt chỗ và đặt vé máy bay có thể nằm ngoài ngày của chuyến đi.")).toBeVisible();
    await expect(form.getByLabel("Tên")).toHaveValue("Long restaurant name for responsive layout");
    await expect(form.getByLabel("Số điện thoại (không bắt buộc)")).toHaveValue("03-1234-5678");
    await expect(form.getByLabel("Liên kết (không bắt buộc)")).toHaveValue("https://example.com/book");

    for (const viewport of [{ width: 320, height: 760 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      await form.scrollIntoViewIfNeeded();
      const bounds = await form.locator("fieldset").filter({ hasText: "Thông tin đặt chỗ" }).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: window.innerWidth };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.width);
    }

    await form.getByLabel("Số điện thoại (không bắt buộc)").fill("050-9999-0000");
    await form.getByLabel("Liên kết (không bắt buộc)").fill("https://example.org/updated");
    await form.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(page.getByRole("status")).toContainText("Đã lưu thay đổi hoạt động");
    const plan = await (await request.get(`/api/trips/${slug}`)).json();
    expect(plan.backbone.find((item) => item.id === reservationId)?.reservationContacts).toEqual([
      { name: "Long restaurant name for responsive layout", phone: "050-9999-0000", link: "https://example.org/updated" },
    ]);
  } finally {
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
    await expect(createForm.locator('[title="Bắt buộc"]')).toHaveCount(1);
    await expect(createForm.getByText("Không bắt buộc", { exact: true })).toHaveCount(4);
    await expect(createForm.getByLabel("Vĩ độ")).toHaveCount(0);
    await expect(createForm.getByLabel("Kinh độ")).toHaveCount(0);
    await createForm.getByLabel("Tên địa điểm").fill(createdPlaceName);
    await expect(createForm.getByLabel("Địa chỉ")).not.toHaveAttribute("required");
    await createForm.getByLabel("Liên kết Google Maps").fill("https://maps.app.goo.gl/example-place");
    await createForm.getByRole("button", { name: "Thêm địa điểm" }).click();
    await expect(places.getByRole("heading", { name: createdPlaceName })).toBeVisible();
    await expect(places.getByRole("link", { name: "Google Maps" })).toHaveAttribute("href", "https://maps.app.goo.gl/example-place");

    const plan = await (await request.get(`/api/trips/${encodeURIComponent(slug)}`)).json();
    expect(plan.places).toEqual([expect.objectContaining({ name: createdPlaceName, address: "", googleMapsUrl: "https://maps.app.goo.gl/example-place" })]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  } finally {
    await request.delete(`/api/trips/${slug}`);
    await sql.end();
  }
});
