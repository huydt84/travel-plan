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
  await expect(page.getByRole("button", { name: "Thêm tuyến đường" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Thêm nguồn tham khảo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Thêm địa điểm" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Góp ý cho hoạt động này" }).first()).toBeVisible();
});

itineraryTest("owner manages route, place, and source references in the public tracker", async ({ page, request, tripSlug }) => {
  const route = await (await request.post(`/api/trips/${tripSlug}/sources`, { data: {
    kind: "route", routeStart: "Hotel", routeEnd: "Station", url: "https://maps.google.com/?q=station",
  } })).json();
  const reference = await (await request.post(`/api/trips/${tripSlug}/sources`, { data: {
    kind: "reference", title: "Opening hours", url: "https://example.com/hours",
  } })).json();
  const place = await (await request.post(`/api/trips/${tripSlug}/places`, { data: {
    name: "Station", address: "Kyoto", website: "https://example.com/station",
  } })).json();
  await gotoHealthy(page, `/?trip=${tripSlug}`);

  const routes = page.getByRole("region", { name: "Tuyến đường" });
  await routes.getByRole("button", { name: "Sửa", exact: true }).click();
  await routes.locator("form").getByLabel("Điểm kết thúc").fill("Museum");
  await routes.locator("form").getByRole("button", { name: "Lưu tuyến đường" }).click();
  await expect(routes.getByRole("link", { name: /Hotel → Museum/ })).toBeVisible();

  const references = page.getByRole("region", { name: "Nguồn tham khảo" });
  await references.getByRole("button", { name: "Sửa", exact: true }).click();
  await references.locator("form").getByLabel("Tên nguồn").fill("Museum hours");
  await references.locator("form").getByRole("button", { name: "Lưu" }).click();
  await expect(references.getByRole("link", { name: /Museum hours/ })).toBeVisible();

  const places = page.getByRole("region", { name: "Địa điểm đã lưu" });
  await places.getByRole("button", { name: "Sửa", exact: true }).click();
  await places.getByRole("form", { name: "Sửa Station" }).getByLabel("Tên địa điểm").fill("Museum");
  await places.getByRole("form", { name: "Sửa Station" }).getByRole("button", { name: "Lưu địa điểm" }).click();
  await expect(places.getByRole("heading", { name: "Museum" })).toBeVisible();

  await routes.getByRole("button", { name: "Thêm tuyến đường" }).click();
  await routes.locator("form").getByLabel("Điểm bắt đầu").fill("Museum");
  await routes.locator("form").getByLabel("Điểm kết thúc").fill("Park");
  await routes.locator("form").getByLabel("Google Maps URL").fill("https://maps.google.com/?q=park");
  await routes.locator("form").getByRole("button", { name: "Thêm tuyến đường" }).click();
  await expect(routes.getByRole("link", { name: /Museum → Park/ })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await routes.getByRole("link", { name: /Museum → Park/ }).locator("..").getByRole("button", { name: "Xoá" }).click();
  await expect(routes.getByRole("link", { name: /Museum → Park/ })).toHaveCount(0);

  await references.getByRole("button", { name: "Thêm nguồn tham khảo" }).click();
  await references.locator("form").getByLabel("Tên nguồn").fill("Park guide");
  await references.locator("form").getByLabel("URL").fill("https://example.com/park");
  await references.locator("form").getByRole("button", { name: "Thêm nguồn" }).click();
  await expect(references.getByRole("link", { name: /Park guide/ })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await references.getByRole("link", { name: /Park guide/ }).locator("..").getByRole("button", { name: "Xoá" }).click();
  await expect(references.getByRole("link", { name: /Park guide/ })).toHaveCount(0);

  await places.getByRole("button", { name: "Thêm địa điểm" }).click();
  await places.getByRole("form", { name: "Thêm địa điểm" }).getByLabel("Tên địa điểm").fill("Park");
  await places.getByRole("form", { name: "Thêm địa điểm" }).getByRole("button", { name: "Thêm địa điểm" }).click();
  await expect(places.getByRole("heading", { name: "Park" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await places.getByRole("heading", { name: "Park" }).locator("../..").getByRole("button", { name: "Xoá" }).click();
  await expect(places.getByRole("heading", { name: "Park" })).toHaveCount(0);

  const plan = await (await request.get(`/api/itinerary?slug=${tripSlug}`)).json();
  expect(plan.sources.find((item) => item.number === route.number)?.routeEnd).toBe("Museum");
  expect(plan.sources.find((item) => item.number === reference.number)?.title).toBe("Museum hours");
  expect(plan.places.find((item) => item.id === place.id)?.name).toBe("Museum");
});
