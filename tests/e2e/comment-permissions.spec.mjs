import { expect, gotoHealthy, test } from "./fixtures.mjs";

const localHeaders = (email, name) => ({
  "x-local-viewer-email": email,
  "x-local-viewer-name": name,
});

test("members manage their own contributions while global hiding stays private", async ({ browser, baseURL }) => {
  const marker = Date.now();
  const authorContext = await browser.newContext({ baseURL, extraHTTPHeaders: localHeaders(`comment-author-${marker}@localhost.invalid`, "Comment Author") });
  const otherContext = await browser.newContext({ baseURL, extraHTTPHeaders: localHeaders(`comment-other-${marker}@localhost.invalid`, "Other Member") });
  const ownerContext = await browser.newContext({ baseURL });
  const authorPage = await authorContext.newPage();
  const otherPage = await otherContext.newPage();
  const ownerPage = await ownerContext.newPage();
  const created = [];
  let slug;

  try {
    await gotoHealthy(otherPage, "/");
    await gotoHealthy(authorPage, "/");
    slug = `comment-permissions-${marker}`;
    const trip = await ownerContext.request.post("/api/trips", { data: {
      slug,
      title: "Comment permissions",
      startDate: "2030-01-01",
      endDate: "2030-01-01",
      timezone: "Asia/Tokyo",
      location: "Tokyo",
      memberEmails: [
        `comment-author-${marker}@localhost.invalid`,
        `comment-other-${marker}@localhost.invalid`,
      ],
    } });
    expect(trip.status()).toBe(201);
    const visibleTrips = await authorContext.request.get("/api/trips");
    expect((await visibleTrips.json()).trips.some((item) => item.slug === slug)).toBe(true);
    expect((await ownerContext.request.post(`/api/trips/${slug}/schedule`, { data: {
      startDate: "2030-01-01",
      endDate: "2030-01-01",
      start: "09:00",
      end: "10:00",
      title: "Comment fixture",
      type: "Visit",
      icon: "x",
      detail: "",
      refs: [],
    } })).status()).toBe(201);
    await gotoHealthy(authorPage, `/?trip=${encodeURIComponent(slug)}`);
    for (const [kind, body] of [["comment", `Bình luận ${marker}`], ["suggestion", `Đề xuất ${marker}`]]) {
      const response = await authorContext.request.post(`/api/trips/${encodeURIComponent(slug)}/suggestions`, { data: { activityId: null, kind, body } });
      expect(response.status()).toBe(201);
      created.push(await response.json());
    }
    const [comment, suggestion] = created;

    await gotoHealthy(ownerPage, `/?trip=${encodeURIComponent(slug)}`);
    const ownerComment = ownerPage.locator(`#contribution-${comment.id}`);
    const ownerSuggestion = ownerPage.locator(`#contribution-${suggestion.id}`);
    for (const contribution of [ownerComment, ownerSuggestion]) {
      await expect(contribution.getByRole("button", { name: "Đã xử lý" })).toBeVisible();
      await expect(contribution.getByRole("button", { name: "Ẩn" })).toBeVisible();
      await expect(contribution.getByRole("button", { name: /Thêm thao tác với/ })).toBeVisible();
    }
    await ownerComment.getByRole("button", { name: "Đã xử lý" }).click();
    await expect(ownerComment.getByRole("button", { name: "Mở lại" })).toBeVisible();
    await ownerComment.getByRole("button", { name: "Mở lại" }).click();
    await expect(ownerComment.getByRole("button", { name: "Đã xử lý" })).toBeVisible();

    await ownerPage.setViewportSize({ width: 390, height: 844 });
    const mobileActions = ownerComment.getByRole("group", { name: "Thao tác với bình luận của Comment Author" });
    await mobileActions.scrollIntoViewIfNeeded();
    for (const button of await mobileActions.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(390);
    }

    expect((await authorContext.request.patch(`/api/trips/${encodeURIComponent(slug)}/suggestions/${comment.id}`, { data: { status: "resolved" } })).status()).toBe(200);
    expect((await authorContext.request.patch(`/api/trips/${encodeURIComponent(slug)}/suggestions/${suggestion.id}`, { data: { status: "resolved" } })).status()).toBe(403);
    for (const contribution of created) {
      expect((await authorContext.request.patch(`/api/trips/${encodeURIComponent(slug)}/suggestions/${contribution.id}`, { data: { hidden: true } })).status()).toBe(200);
    }

    const authorList = await authorContext.request.get(`/api/trips/${encodeURIComponent(slug)}/suggestions`);
    const otherList = await otherContext.request.get(`/api/trips/${encodeURIComponent(slug)}/suggestions`);
    expect((await authorList.json()).suggestions.filter((item) => created.some((createdItem) => createdItem.id === item.id))).toHaveLength(2);
    expect((await otherList.json()).suggestions.some((item) => created.some((createdItem) => createdItem.id === item.id))).toBe(false);

    await authorPage.reload();
    const drawer = authorPage.locator(".trip-suggestions .hidden-suggestion-drawer");
    await expect(drawer.getByRole("button", { name: /2 nội dung đã ẩn/ })).toBeVisible();
    await drawer.getByRole("button", { name: /2 nội dung đã ẩn/ }).click();
    const hiddenComment = authorPage.locator(`#contribution-${comment.id}`);
    await expect(hiddenComment).toContainText(`Bình luận ${marker}`);
    await hiddenComment.getByRole("button", { name: "Hiện lại" }).click();
    await expect(drawer.getByRole("button", { name: /1 nội dung đã ẩn/ })).toBeFocused();

    await expect(hiddenComment).toBeVisible();
    await hiddenComment.getByRole("button", { name: /Thêm thao tác với bình luận/ }).click();
    await hiddenComment.getByRole("menuitem", { name: "Xoá vĩnh viễn" }).click();
    const dialog = authorPage.getByRole("alertdialog", { name: "Xoá vĩnh viễn nội dung này?" });
    await expect(dialog).toContainText(`Bình luận ${marker}`);
    await dialog.getByRole("button", { name: "Huỷ" }).click();
    await expect(dialog).toHaveCount(0);
    await hiddenComment.getByRole("button", { name: /Thêm thao tác với bình luận/ }).click();
    await hiddenComment.getByRole("menuitem", { name: "Xoá vĩnh viễn" }).click();
    await authorPage.getByRole("alertdialog").getByRole("button", { name: "Xoá vĩnh viễn" }).click();
    await expect(hiddenComment).toHaveCount(0);
    created.splice(0, 1);
  } finally {
    if (slug) {
      await ownerContext.request.delete(`/api/trips/${encodeURIComponent(slug)}`);
    }
    await authorContext.close();
    await otherContext.close();
    await ownerContext.close();
  }
});

test("owner promotes and demotes an admin without sharing role management", async ({ browser, baseURL }) => {
  const marker = Date.now();
  const adminEmail = `promoted-admin-${marker}@localhost.invalid`;
  const memberContext = await browser.newContext({ baseURL, extraHTTPHeaders: localHeaders(adminEmail, "Trip Admin") });
  const ownerContext = await browser.newContext({ baseURL });
  const memberPage = await memberContext.newPage();
  const ownerPage = await ownerContext.newPage();

  try {
    await gotoHealthy(memberPage, "/");
    await gotoHealthy(ownerPage, "/admin/users");
    const ownerRow = ownerPage.locator(".admin-users-table tbody tr").filter({ hasText: "local-admin@localhost.invalid" });
    await expect(ownerRow).toContainText("Owner");
    await expect(ownerRow.getByRole("combobox")).toHaveCount(0);
    const row = ownerPage.locator(".admin-users-table tbody tr").filter({ hasText: adminEmail });
    await expect(row).toBeVisible();
    await row.getByRole("combobox", { name: /Quyền của/ }).selectOption("admin");
    const promoteDialog = ownerPage.getByRole("alertdialog", { name: "Cấp quyền Admin?" });
    await expect(promoteDialog).toContainText(adminEmail);
    await promoteDialog.getByRole("button", { name: "Cấp quyền Admin" }).click();
    await expect(row.getByRole("combobox", { name: /Quyền của/ })).toHaveValue("admin");

    await gotoHealthy(memberPage, "/admin/trips");
    await expect(memberPage.getByRole("heading", { level: 1, name: "Quản lý lịch" })).toBeVisible();
    expect((await memberContext.request.patch(`/api/admin/users/${encodeURIComponent(adminEmail)}`, { data: { role: "member" } })).status()).toBe(403);

    await ownerPage.reload();
    const promotedRow = ownerPage.locator(".admin-users-table tbody tr").filter({ hasText: adminEmail });
    await promotedRow.getByRole("combobox", { name: /Quyền của/ }).selectOption("member");
    await ownerPage.getByRole("alertdialog", { name: "Hạ xuống Member?" }).getByRole("button", { name: "Hạ xuống Member" }).click();
    await expect(promotedRow.getByRole("combobox", { name: /Quyền của/ })).toHaveValue("member");

    await memberPage.reload();
    await expect(memberPage.getByRole("heading", { level: 1, name: "Gửi góp ý trên lịch" })).toBeVisible();
    expect((await memberContext.request.patch("/api/trips/not-a-real-trip", { data: { title: "Không được phép" } })).status()).toBe(404);
  } finally {
    await ownerContext.request.patch(`/api/admin/users/${encodeURIComponent(adminEmail)}`, { data: { role: "member" } });
    await memberContext.close();
    await ownerContext.close();
  }
});

test("visibility notifications open the hidden drawer and remain idempotent", async ({ browser, baseURL }) => {
  const marker = Date.now();
  const authorEmail = `hidden-notification-${marker}@localhost.invalid`;
  const authorContext = await browser.newContext({ baseURL, extraHTTPHeaders: localHeaders(authorEmail, "Hidden Author") });
  const ownerContext = await browser.newContext({ baseURL });
  const authorPage = await authorContext.newPage();
  let contribution;
  let slug;

  try {
    await gotoHealthy(authorPage, "/");
    slug = `visibility-notification-${marker}`;
    const trip = await authorContext.request.post("/api/trips", { data: {
      slug,
      title: "Visibility notification",
      startDate: "2030-01-01",
      endDate: "2030-01-01",
      timezone: "Asia/Tokyo",
      location: "Tokyo",
    } });
    expect(trip.status()).toBe(201);
    await gotoHealthy(authorPage, `/?trip=${encodeURIComponent(slug)}`);
    const created = await authorContext.request.post(`/api/trips/${encodeURIComponent(slug)}/suggestions`, {
      data: { activityId: null, kind: "comment", body: `Sẽ được ẩn ${marker}` },
    });
    contribution = await created.json();
    const targetUrl = `/api/trips/${encodeURIComponent(slug)}/suggestions/${contribution.id}`;
    expect((await ownerContext.request.patch(targetUrl, { data: { hidden: true } })).status()).toBe(200);
    expect((await ownerContext.request.patch(targetUrl, { data: { hidden: true } })).status()).toBe(200);

    const notifications = await authorContext.request.get("/api/notifications");
    expect((await notifications.json()).notifications.filter((item) => item.type === "contribution_visibility_changed" && item.contribution.id === contribution.id)).toHaveLength(1);

    await authorPage.reload();
    const bell = authorPage.getByRole("button", { name: /Mở thông báo, 1 thông báo chưa đọc/ });
    await bell.click();
    const notification = authorPage.locator(".notification-list button").filter({ hasText: "Nội dung của bạn đã được ẩn" });
    await notification.click();
    const target = authorPage.locator(`#contribution-${contribution.id}`);
    await expect(target).toBeVisible();
    await expect(target).toBeFocused();
    await expect(target).toHaveClass(/is-notification-target/);
    await expect(target.locator(".suggestion-status.hidden")).toHaveText("Đã ẩn");
  } finally {
    if (slug) await ownerContext.request.delete(`/api/trips/${encodeURIComponent(slug)}`);
    await authorContext.close();
    await ownerContext.close();
  }
});


test("deletion confirmation contains keyboard focus, blocks pending dismissal, and recovers from errors", async ({ page, request, runtimeHealth }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await gotoHealthy(page, "/");
  const slug = await page.getByRole("combobox", { name: "Chọn chuyến đi" }).getAttribute("data-trip-slug");
  const created = await request.post(`/api/trips/${slug}/suggestions`, {
    data: { activityId: null, kind: "comment", body: `Confirmation behavior ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const contribution = await created.json();
  try {
    await page.reload();
    const row = page.locator(`#contribution-${contribution.id}`);
    await row.getByRole("button", { name: /Thêm thao tác/ }).click();
    await row.getByRole("menuitem", { name: "Xoá vĩnh viễn" }).click();
    const confirmation = page.getByRole("alertdialog");
    await expect(
      confirmation.getByRole("button", { name: "Huỷ", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      confirmation.getByRole("button", { name: "Xoá vĩnh viễn" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      confirmation.getByRole("button", { name: "Huỷ", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);

    await row.getByRole("button", { name: /Thêm thao tác/ }).click();
    await row.getByRole("menuitem", { name: "Xoá vĩnh viễn" }).click();
    let release;
    const pendingResponse = new Promise((resolve) => {
      release = resolve;
    });
    await page.route(
      `**/api/trips/${slug}/suggestions/${contribution.id}`,
      async (route) => {
        if (route.request().method() !== "DELETE") return route.continue();
        await pendingResponse;
        await route.fulfill({ status: 409, json: { error: "Thử lại sau" } });
      },
    );
    try {
      await confirmation
        .getByRole("button", { name: "Xoá vĩnh viễn" })
        .click();
      await expect(
        confirmation.getByRole("button", { name: "Huỷ", exact: true }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await page.mouse.click(2, 2);
      await expect(confirmation).toBeVisible();
    } finally {
      release();
    }
    await expect(confirmation.getByRole("alert")).toContainText(
      "Thử lại sau",
    );
    await expect(
      confirmation.getByRole("button", { name: "Xoá vĩnh viễn" }),
    ).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    // Chromium logs the intentional conflict used to exercise retry behavior.
    runtimeHealth.splice(
      0,
      runtimeHealth.length,
      ...runtimeHealth.filter((message) => !message.includes("409")),
    );
  } finally {
    await page.goto("about:blank");
    expect((await request.delete(`/api/trips/${slug}/suggestions/${contribution.id}`)).status()).toBe(204);
  }
});
