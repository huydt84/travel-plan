import { expect, gotoHealthy, test } from "./fixtures.mjs";

const localHeaders = (email, name) => ({
  "x-local-viewer-email": email,
  "x-local-viewer-name": name,
});

const requestPayload = (marker, place = "Kamakura") => ({
  startDate: "2026-10-10",
  endDate: "2026-10-12",
  places: [`${place} ${marker}`, "Enoshima"],
  sources: [{ label: "Official guide", url: "https://example.com/guide" }],
  notes: "Có thể đổi giờ khởi hành.",
});

test("member lifecycle, admin fulfillment, and in-app notification stay connected", async ({ browser, baseURL }) => {
  const marker = Date.now();
  const memberEmail = `trip-request-${marker}@localhost.invalid`;
  const memberContext = await browser.newContext({ baseURL, extraHTTPHeaders: localHeaders(memberEmail, "Trip Requester") });
  const otherContext = await browser.newContext({ baseURL, extraHTTPHeaders: localHeaders(`other-request-${marker}@localhost.invalid`, "Other Requester") });
  const ownerContext = await browser.newContext({ baseURL });
  const memberPage = await memberContext.newPage();
  const ownerPage = await ownerContext.newPage();

  try {
    await gotoHealthy(memberPage, "/requests");
    const createdResponse = await memberContext.request.post("/api/trip-requests", { data: requestPayload(marker) });
    expect(createdResponse.status()).toBe(201);
    let created = await createdResponse.json();
    expect(created.state).toBe("open");
    expect(created.places).toEqual([`Kamakura ${marker}`, "Enoshima"]);

    expect((await otherContext.request.patch(`/api/trip-requests/${created.id}`, { data: { action: "withdraw" } })).status()).toBe(404);
    const withdrawn = await memberContext.request.patch(`/api/trip-requests/${created.id}`, { data: { action: "withdraw" } });
    expect((await withdrawn.json()).state).toBe("withdrawn");
    const restored = await memberContext.request.patch(`/api/trip-requests/${created.id}`, { data: { action: "restore" } });
    expect((await restored.json()).state).toBe("open");

    const tripsResponse = await ownerContext.request.get("/api/trips");
    const listedTrips = (await tripsResponse.json()).trips;
    const trip = listedTrips.find((item) => item.slug === "kamakura-2026-08-09") || listedTrips.at(-1);
    const attachedResponse = await ownerContext.request.put(`/api/admin/trip-requests/${created.id}/fulfillment`, { data: { tripSlug: trip.slug } });
    expect(attachedResponse.status()).toBe(200);
    created = await attachedResponse.json();
    expect(created.state).toBe("fulfilled");
    expect(created.trip.slug).toBe(trip.slug);

    const duplicateAttach = await ownerContext.request.put(`/api/admin/trip-requests/${created.id}/fulfillment`, { data: { tripSlug: trip.slug } });
    expect(duplicateAttach.status()).toBe(200);
    const notifications = await memberContext.request.get("/api/notifications");
    const fulfillmentNotifications = (await notifications.json()).notifications.filter((item) => item.type === "trip_request_fulfilled" && item.request.id === created.id);
    expect(fulfillmentNotifications).toHaveLength(1);
    expect(fulfillmentNotifications[0].targetUrl).toBe(`/?trip=${encodeURIComponent(trip.slug)}`);

    await memberPage.reload();
    await memberPage.getByRole("button", { name: /Mở thông báo/ }).click();
    const notification = memberPage.locator(".notification-list button").filter({ hasText: "Lịch trình cho yêu cầu của bạn đã sẵn sàng" });
    await expect(notification).toBeVisible();
    await notification.click();
    await expect(memberPage).toHaveURL(new RegExp(`trip=${trip.slug}`));

    const detached = await ownerContext.request.delete(`/api/admin/trip-requests/${created.id}/fulfillment`);
    expect((await detached.json()).state).toBe("open");
    const declined = await ownerContext.request.patch(`/api/admin/trip-requests/${created.id}`, { data: { action: "decline", reason: "Chưa đủ thời gian chuẩn bị" } });
    expect((await declined.json()).state).toBe("declined");
    const adminRestored = await ownerContext.request.patch(`/api/admin/trip-requests/${created.id}`, { data: { action: "restore" } });
    expect((await adminRestored.json()).state).toBe("open");

    await gotoHealthy(ownerPage, "/admin/requests");
    await ownerPage.getByRole("searchbox", { name: "Tìm người hoặc địa điểm" }).fill(String(marker));
    await expect(ownerPage.locator(".request-admin-row").filter({ hasText: String(marker) })).toBeVisible();
  } finally {
    await memberContext.close();
    await otherContext.close();
    await ownerContext.close();
  }
});

test("creating a trip from a request is transactional and deletion reopens the request", async ({ browser, baseURL }) => {
  const marker = Date.now();
  const memberContext = await browser.newContext({ baseURL, extraHTTPHeaders: localHeaders(`trip-create-${marker}@localhost.invalid`, "Plan Requester") });
  const ownerContext = await browser.newContext({ baseURL });
  const slug = `request-plan-${marker}`;
  try {
    await gotoHealthy(await memberContext.newPage(), "/requests");
    const requestResponse = await memberContext.request.post("/api/trip-requests", { data: requestPayload(marker, "Nikko") });
    const request = await requestResponse.json();
    const created = await ownerContext.request.post(`/api/admin/trip-requests/${request.id}/trip`, {
      data: {
        slug,
        title: `Nikko ${marker}`,
        startDate: request.startDate,
        endDate: request.endDate,
        timezone: "Asia/Tokyo",
        location: request.places.join(", "),
      },
    });
    expect(created.status()).toBe(201);
    expect((await created.json()).slug).toBe(slug);
    const list = await memberContext.request.get("/api/trip-requests");
    expect((await list.json()).requests.find((item) => item.id === request.id).state).toBe("fulfilled");

    expect((await ownerContext.request.delete(`/api/trips/${slug}`)).status()).toBe(204);
    const reopened = await memberContext.request.get("/api/trip-requests");
    expect((await reopened.json()).requests.find((item) => item.id === request.id).state).toBe("open");
  } finally {
    await memberContext.close();
    await ownerContext.close();
  }
});
