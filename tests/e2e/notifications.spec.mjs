import { expect, gotoHealthy, test } from "./fixtures.mjs";

const localHeaders = (email, name) => ({
  "x-local-viewer-email": email,
  "x-local-viewer-name": name,
});

test("contributors receive in-app updates while owner delivery stays email-only", async ({ browser, baseURL }) => {
  const marker = Date.now();
  const aEmail = `notification-a-${marker}@localhost.invalid`;
  const bEmail = `notification-b-${marker}@localhost.invalid`;
  const bodyA = `Điểm hẹn của A ${marker}`;
  const bodyB = `Cập nhật từ B ${marker}`;
  const contextA = await browser.newContext({ baseURL, extraHTTPHeaders: localHeaders(aEmail, "Friend A") });
  const contextB = await browser.newContext({ baseURL, extraHTTPHeaders: localHeaders(bEmail, "Friend B") });
  const ownerContext = await browser.newContext({ baseURL });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const ownerPage = await ownerContext.newPage();
  let suggestionA;
  let suggestionB;
  let slug;

  try {
    await gotoHealthy(pageA, "/");
    slug = await pageA.getByRole("combobox", { name: "Chọn chuyến đi" }).inputValue();

    const responseA = await contextA.request.post(`/api/trips/${encodeURIComponent(slug)}/suggestions`, {
      data: { activityId: null, kind: "comment", body: bodyA },
    });
    expect(responseA.status()).toBe(201);
    suggestionA = await responseA.json();

    const responseB = await contextB.request.post(`/api/trips/${encodeURIComponent(slug)}/suggestions`, {
      data: { activityId: null, kind: "suggestion", body: bodyB },
    });
    expect(responseB.status()).toBe(201);
    suggestionB = await responseB.json();

    await pageA.reload();
    const aBell = pageA.getByRole("button", { name: /Mở thông báo, 1 thông báo chưa đọc/ });
    await expect(aBell).toBeVisible();
    await aBell.click();
    await expect(pageA.getByRole("heading", { name: "Thông báo" })).toBeVisible();
    const createdItem = pageA.locator(".notification-list button").filter({ hasText: bodyB });
    await expect(createdItem).toContainText("Friend B đã gửi một đề xuất");
    await createdItem.click();
    await expect(pageA).toHaveURL(new RegExp(`#contribution-${suggestionB.id}$`));
    const contributionTarget = pageA.locator(`#contribution-${suggestionB.id}`);
    await expect(contributionTarget).toBeVisible();
    await expect(contributionTarget).toBeFocused();
    await expect(contributionTarget).toHaveClass(/is-notification-target/);
    await expect(pageA.getByRole("button", { name: "Mở thông báo" })).toBeVisible();

    const selfNotifications = await contextB.request.get("/api/notifications");
    expect(selfNotifications.status()).toBe(200);
    expect((await selfNotifications.json()).notifications.some((item) => item.contribution.id === suggestionB.id)).toBe(false);

    const moderation = await ownerContext.request.patch(`/api/trips/${encodeURIComponent(slug)}/suggestions/${suggestionB.id}`, {
      data: { status: "resolved" },
    });
    expect(moderation.status()).toBe(200);
    const statusNotifications = await contextB.request.get("/api/notifications");
    expect(statusNotifications.status()).toBe(200);
    const statusNotificationCount = (await statusNotifications.json()).notifications
      .filter((item) => item.type === "contribution_status_changed" && item.contribution.id === suggestionB.id).length;
    expect(statusNotificationCount).toBe(1);
    const repeatedModeration = await ownerContext.request.patch(`/api/trips/${encodeURIComponent(slug)}/suggestions/${suggestionB.id}`, {
      data: { status: "resolved" },
    });
    expect(repeatedModeration.status()).toBe(200);
    const afterRepeatedModeration = await contextB.request.get("/api/notifications");
    expect((await afterRepeatedModeration.json()).notifications
      .filter((item) => item.type === "contribution_status_changed" && item.contribution.id === suggestionB.id)).toHaveLength(1);

    await gotoHealthy(pageB, `/?trip=${encodeURIComponent(slug)}`);
    const bBell = pageB.getByRole("button", { name: /Mở thông báo, 1 thông báo chưa đọc/ });
    await expect(bBell).toBeVisible();
    await pageB.setViewportSize({ width: 390, height: 844 });
    await bBell.click();
    const panel = pageB.locator(".notification-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Góp ý của bạn: Đã xử lý");
    const panelBox = await panel.boundingBox();
    expect(panelBox.x).toBeGreaterThanOrEqual(9);
    expect(panelBox.y).toBeGreaterThanOrEqual(9);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(381);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(835);
    const readAllButton = pageB.getByRole("button", { name: "Đánh dấu tất cả đã đọc" });
    const readAllBox = await readAllButton.boundingBox();
    expect(readAllBox.height).toBeGreaterThanOrEqual(44);
    await readAllButton.click();
    await expect(readAllButton).toBeDisabled();
    // The modal hides the background from the accessibility tree until closed.
    await pageB.keyboard.press("Escape");
    await expect(pageB.getByRole("button", { name: "Mở thông báo" })).toBeVisible();

    await gotoHealthy(ownerPage, `/?trip=${encodeURIComponent(slug)}`);
    await expect(ownerPage.getByRole("button", { name: /Mở thông báo/ })).toBeVisible();

    const rejection = await ownerContext.request.patch(`/api/trips/${encodeURIComponent(slug)}/suggestions/${suggestionB.id}`, {
      data: { status: "rejected" },
    });
    expect(rejection.status()).toBe(200);
    const notificationsAfterRejection = await contextA.request.get("/api/notifications");
    expect(notificationsAfterRejection.status()).toBe(200);
    expect((await notificationsAfterRejection.json()).notifications.some((item) => item.contribution.id === suggestionB.id)).toBe(false);
  } finally {
    if (suggestionA && slug) await ownerContext.request.delete(`/api/trips/${encodeURIComponent(slug)}/suggestions/${suggestionA.id}`);
    if (suggestionB && slug) await ownerContext.request.delete(`/api/trips/${encodeURIComponent(slug)}/suggestions/${suggestionB.id}`);
    await contextA.close();
    await contextB.close();
    await ownerContext.close();
  }
});

test("participation survives deletion and notification APIs enforce pagination and ownership", async ({ browser, baseURL }) => {
  const marker = Date.now();
  const aEmail = `notification-history-a-${marker}@localhost.invalid`;
  const bEmail = `notification-history-b-${marker}@localhost.invalid`;
  const contextA = await browser.newContext({ baseURL, extraHTTPHeaders: localHeaders(aEmail, "History A") });
  const contextB = await browser.newContext({ baseURL, extraHTTPHeaders: localHeaders(bEmail, "History B") });
  const ownerContext = await browser.newContext({ baseURL });
  const pageA = await contextA.newPage();
  const created = [];
  let slug;

  try {
    await gotoHealthy(pageA, "/");
    slug = await pageA.getByRole("combobox", { name: "Chọn chuyến đi" }).inputValue();

    const firstContribution = await contextA.request.post(`/api/trips/${encodeURIComponent(slug)}/suggestions`, {
      data: { activityId: null, kind: "comment", body: `A tham gia ${marker}` },
    });
    expect(firstContribution.status()).toBe(201);
    const contributionA = await firstContribution.json();
    expect((await ownerContext.request.delete(`/api/trips/${encodeURIComponent(slug)}/suggestions/${contributionA.id}`)).status()).toBe(204);

    for (const index of [1, 2]) {
      const response = await contextB.request.post(`/api/trips/${encodeURIComponent(slug)}/suggestions`, {
        data: { activityId: null, kind: "suggestion", body: `B cập nhật ${index} · ${marker}` },
      });
      expect(response.status()).toBe(201);
      created.push(await response.json());
    }

    const firstPageResponse = await contextA.request.get("/api/notifications?limit=1");
    expect(firstPageResponse.status()).toBe(200);
    const firstPage = await firstPageResponse.json();
    expect(firstPage.notifications).toHaveLength(1);
    expect(firstPage.unreadCount).toBe(2);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPageResponse = await contextA.request.get(`/api/notifications?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`);
    expect(secondPageResponse.status()).toBe(200);
    const secondPage = await secondPageResponse.json();
    expect(secondPage.notifications).toHaveLength(1);
    expect(secondPage.notifications[0].id).not.toBe(firstPage.notifications[0].id);

    const notificationId = firstPage.notifications[0].id;
    expect((await contextB.request.patch(`/api/notifications/${notificationId}`)).status()).toBe(404);
    const firstMark = await contextA.request.patch(`/api/notifications/${notificationId}`);
    expect(firstMark.status()).toBe(200);
    const firstMarkResult = await firstMark.json();
    const secondMark = await contextA.request.patch(`/api/notifications/${notificationId}`);
    expect(secondMark.status()).toBe(200);
    expect((await secondMark.json()).readAt).toBe(firstMarkResult.readAt);

    const readAll = await contextA.request.post("/api/notifications/read-all");
    expect(readAll.status()).toBe(200);
    expect((await readAll.json()).unreadCount).toBe(0);
    const afterReadAll = await contextA.request.get("/api/notifications?limit=1");
    expect((await afterReadAll.json()).unreadCount).toBe(0);
  } finally {
    if (slug) {
      for (const contribution of created) {
        await ownerContext.request.delete(`/api/trips/${encodeURIComponent(slug)}/suggestions/${contribution.id}`);
      }
    }
    await pageA.close();
    await contextA.close();
    await contextB.close();
    await ownerContext.close();
  }
});

test("empty notification panel closes with Escape and restores trigger focus", async ({ browser, baseURL }) => {
  const marker = Date.now();
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: localHeaders(`notification-empty-${marker}@localhost.invalid`, "Empty Contributor"),
  });
  const page = await context.newPage();

  try {
    await gotoHealthy(page, "/");
    const bell = page.getByRole("button", { name: "Mở thông báo" });
    await bell.click();
    await expect(page.getByText("Chưa có cập nhật", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Thông báo" })).toHaveCount(0);
    await expect(bell).toBeFocused();
  } finally {
    await page.close();
    await context.close();
  }
});

test("notification panel recovers from an initial API error", async ({ browser, baseURL }) => {
  const marker = Date.now();
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: localHeaders(`notification-error-${marker}@localhost.invalid`, "Error Contributor"),
  });
  const page = await context.newPage();

  try {
    await page.route("**/api/notifications?**", (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Bảng tin đang tạm ngắt" }),
    }), { times: 1 });
    await gotoHealthy(page, "/");
    await page.getByRole("button", { name: "Mở thông báo" }).click();
    await expect(page.locator(".notification-state[role='alert']")).toContainText("Bảng tin đang tạm ngắt");
    await page.getByRole("button", { name: "Thử lại" }).click();
    await expect(page.getByText("Chưa có cập nhật", { exact: true })).toBeVisible();
  } finally {
    await page.close();
    await context.close();
  }
});
