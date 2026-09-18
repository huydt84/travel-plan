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

test("groups activities outside the trip range into preparation and post-trip day tabs", async ({ page, request }) => {
  const slug = `trip-boundary-tabs-${Date.now()}`;
  const trip = {
    slug,
    title: "Chuyến đi có việc trước và sau",
    startDate: "2032-04-10",
    endDate: "2032-04-12",
    timezone: "Asia/Tokyo",
    location: "Tokyo",
  };

  expect((await request.post("/api/trips", { data: trip })).status()).toBe(201);
  try {
    for (const item of [
      {
        startDate: "2032-04-09", start: "12:00", endDate: "2032-04-09", end: "12:15",
        type: "Reservation", icon: "📞", title: "Gọi đặt bàn", detail: "Chuẩn bị trước chuyến", refs: [],
      },
      {
        startDate: "2032-04-10", start: "09:00", endDate: "2032-04-10", end: "10:00",
        type: "Visit", icon: "📍", title: "Ngày đầu", detail: "Hoạt động trong chuyến", refs: [],
      },
      {
        startDate: "2032-04-13", start: "09:00", endDate: "2032-04-13", end: "09:15",
        type: "Reservation", icon: "📞", title: "Gửi lời cảm ơn", detail: "Việc sau chuyến", refs: [],
      },
    ]) {
      expect((await request.post(`/api/trips/${slug}/schedule`, { data: item })).status()).toBe(201);
    }

    for (const viewport of [
      { width: 320, height: 760 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await gotoHealthy(page, `/?trip=${slug}`);
      const days = page.getByRole("navigation", { name: "Chọn ngày trong chuyến đi" });
      const preparation = days.getByRole("button", { name: /Chuẩn bị/ });
      const postTrip = days.getByRole("button", { name: /Sau chuyến đi/ });

      await expect(days.getByRole("button")).toHaveCount(5);
      await expect(preparation).toHaveAttribute("aria-current", "date");
      await expect(page.getByRole("heading", { name: "Gọi đặt bàn", exact: true }).last()).toBeVisible();

      await days.getByRole("button", { name: /Ngày 2/ }).click();
      await preparation.click();
      await expect(preparation).toHaveAttribute("aria-current", "date");
      await expect(page.getByRole("heading", { name: "Gọi đặt bàn", exact: true }).last()).toBeVisible();

      await postTrip.click();
      await expect(postTrip).toHaveAttribute("aria-current", "date");
      await expect(page.getByRole("heading", { name: "Gửi lời cảm ơn", exact: true }).last()).toBeVisible();
    }
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

test("branch edits order evening and next-morning activities by date", async ({ page, request }) => {
  const slug = `multi-day-branch-${Date.now()}`;
  const schedule = (title, date, start, end) => ({
    title, startDate: date, endDate: date, start, end,
    type: "Visit", icon: "📍", detail: "", refs: [],
  });
  try {
    expect((await request.post("/api/trips", { data: {
      slug, title: "Multi-day branch", startDate: "2032-04-10", endDate: "2032-04-11",
      timezone: "Asia/Tokyo", location: "Tokyo",
    } })).status()).toBe(201);
    const ids = [];
    for (const item of [
      schedule("Anchor", "2032-04-10", "16:00", "17:00"),
      schedule("Evening", "2032-04-10", "18:00", "19:00"),
      schedule("Rejoin", "2032-04-11", "12:00", "13:00"),
    ]) {
      const response = await request.post(`/api/trips/${slug}/schedule`, { data: item });
      expect(response.status()).toBe(201);
      ids.push((await response.json()).id);
    }
    const response = await request.post(`/api/trips/${slug}/branches`, { data: {
      title: "Overnight alternatives", anchorActivityId: ids[0], segmentActivityIds: [ids[1]],
      defaultBranch: { key: "normal", label: "Normal", condition: "Normal conditions" },
      alternateBranch: { key: "skip", label: "Skip", condition: "Skip the stops" },
    } });
    expect(response.status()).toBe(201);
    const plan = await response.json();
    const branch = plan.branchGroups[0].branches.find((item) => item.isDefault);
    const morning = await request.post(`/api/trips/${slug}/schedule`, { data: {
      ...schedule("Morning", "2032-04-11", "09:00", "10:00"), branchId: branch.id,
    } });
    expect(morning.status()).toBe(201);
    const morningId = (await morning.json()).id;
    const updated = await request.patch(`/api/trips/${slug}/schedule/${morningId}`, { data: { start: "09:15" } });
    expect(updated.status()).toBe(200);
    const overlap = await request.patch(`/api/trips/${slug}/schedule/${morningId}`, { data: {
      startDate: "2032-04-10", endDate: "2032-04-10", start: "18:30", end: "19:30",
    } });
    expect(overlap.status()).toBe(400);

    await gotoHealthy(page, `/?trip=${slug}`);
    await page.getByRole("navigation", { name: "Chọn ngày trong chuyến đi" }).getByRole("button", { name: /Ngày 2/ }).click();
    await expect(page.getByRole("heading", { name: "Morning", exact: true }).last()).toBeVisible();
    const final = await (await request.get(`/api/trips/${slug}`)).json();
    expect(final.branchGroups[0].branches.find((item) => item.id === branch.id).itinerary.map((item) => item.title))
      .toEqual(["Evening", "Morning"]);
  } finally {
    await request.delete(`/api/trips/${slug}`);
  }
});
