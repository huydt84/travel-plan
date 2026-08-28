import { expect, gotoHealthy, test } from "./fixtures.mjs";

test("creates and browses a multi-day route with an empty day and overnight stop", async ({ page, request }) => {
  const slug = `multi-day-${Date.now()}`;
  const trip = {
    slug,
    title: "Kyoto nhiều ngày",
    startDate: "2032-04-10",
    endDate: "2032-04-13",
    timezone: "Asia/Tokyo",
    location: "Kyoto",
  };

  expect((await request.post("/api/trips", { data: trip })).status()).toBe(201);
  try {
    const first = await request.post(`/api/trips/${slug}/schedule`, { data: {
      startDate: "2032-04-10", start: "09:00", endDate: "2032-04-10", end: "10:00",
      type: "Visit", icon: "📍", title: "Đền đầu tiên", detail: "Ngày đầu", refs: [], branchId: null,
    } });
    expect(first.status()).toBe(201);
    const overnight = await request.post(`/api/trips/${slug}/schedule`, { data: {
      startDate: "2032-04-11", start: "23:30", endDate: "2032-04-12", end: "01:00",
      type: "Transit", icon: "🚆", title: "Tàu đêm", detail: "Qua nửa đêm", refs: [], branchId: null,
    } });
    expect(overnight.status()).toBe(201);

    const final = await request.post(`/api/trips/${slug}/schedule`, { data: {
      startDate: "2032-04-13", start: "20:30", endDate: "2032-04-13", end: "22:00",
      type: "Dinner", icon: "🍽️", title: "Bữa tối cuối chuyến", detail: "Ngày cuối", refs: [], branchId: null,
    } });
    expect(final.status()).toBe(201);

    await gotoHealthy(page, `/?trip=${slug}`);
    const days = page.getByRole("navigation", { name: "Chọn ngày trong chuyến đi" });
    await expect(days.getByRole("button")).toHaveCount(4);

    await days.getByRole("button", { name: /Ngày 3/ }).click();
    await expect(page.getByRole("heading", { name: "Ngày này chưa có hoạt động" })).toBeVisible();

    await days.getByRole("button", { name: /Ngày 1/ }).click();
    await expect(page.getByRole("link", { name: /Tàu đêm/ }).first()).toContainText("11/04");
    await page.getByRole("link", { name: /Tàu đêm/ }).first().click();
    await expect(days.getByRole("button", { name: /Ngày 2/ })).toHaveAttribute("aria-current", "date");
    await expect(page.getByText("Đang xem trước").first()).toBeVisible();
    await expect(page.getByText(/12\/04.*01:00/).first()).toBeVisible();

    const unsafeShrink = await request.patch(`/api/trips/${slug}`, { data: {
      startDate: "2032-04-10", endDate: "2032-04-12",
    } });
    expect(unsafeShrink.status()).toBe(400);
    expect((await unsafeShrink.json()).error).toContain("1 hoạt động");

    const moved = await request.patch(`/api/trips/${slug}`, { data: {
      startDate: "2032-05-10", endDate: "2032-05-13", moveSchedule: true,
    } });
    expect(moved.status()).toBe(200);
    const movedPlan = await (await request.get(`/api/itinerary?slug=${slug}`)).json();
    expect(movedPlan.itinerary.map((item) => [item.startDate, item.endDate])).toEqual([
      ["2032-05-10", "2032-05-10"],
      ["2032-05-11", "2032-05-12"],
      ["2032-05-13", "2032-05-13"],
    ]);
  } finally {
    await request.delete(`/api/trips/${slug}`);
  }
});

test("admin trip form exposes a date range", async ({ page }) => {
  await gotoHealthy(page, "/admin/trips");
  await page.getByRole("complementary").getByRole("button", { name: "Thêm", exact: true }).click();
  await expect(page.getByLabel("Ngày bắt đầu")).toBeVisible();
  await expect(page.getByLabel("Ngày kết thúc")).toBeVisible();
});
