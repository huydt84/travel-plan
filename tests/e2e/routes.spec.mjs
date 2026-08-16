import { expect, gotoHealthy, test } from "./fixtures.mjs";

const ownerRoutes = [
  {
    path: "/admin/trips",
    heading: /Quản lý lịch/,
    currentNav: "Lịch trình",
  },
  {
    path: "/admin/invitations",
    heading: "Lời rủ",
    section: "Quyền gửi lời rủ",
    currentNav: /Lời rủ/,
  },
  {
    path: "/admin/invitations?view=history",
    heading: "Lời rủ",
    section: "Lịch sử gửi",
    currentNav: /Lời rủ/,
  },
  {
    path: "/admin/users",
    heading: "Người dùng",
    section: "Hoạt động người dùng",
    currentNav: "Người dùng",
  },
];

test("public tracker renders its primary controls", async ({ page }) => {
  await gotoHealthy(page, "/");

  await expect(page.getByRole("combobox", { name: "Chọn chuyến đi" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rủ bạn đi cùng", exact: true })).toBeVisible();
  await expect(page.getByText("Local admin", { exact: true })).toBeVisible();
});

test("public tracker title reflects the current trip state", async ({ page }) => {
  await gotoHealthy(page, "/");

  await expect(page).toHaveTitle(/^(Sắp bắt đầu|Đang diễn ra|Đang chờ|Đã kết thúc) · /);
});

test("activity heartbeat pauses in hidden tabs and resumes when visible", async ({ page }) => {
  let activityRequests = 0;
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => window.__activityTestVisibility || "visible",
    });
  });
  await page.clock.install({ time: new Date("2026-08-15T00:00:00.000Z") });
  await page.route("**/api/activity", async (route) => {
    activityRequests += 1;
    await route.fulfill({ status: 204 });
  });

  await gotoHealthy(page, "/");
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(activityRequests).toBeGreaterThan(0);
  const visibleRequestCount = activityRequests;

  await page.evaluate(() => { window.__activityTestVisibility = "hidden"; });
  await page.clock.fastForward(5 * 60 * 1000);
  expect(activityRequests).toBe(visibleRequestCount);

  await page.evaluate(() => {
    window.__activityTestVisibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => activityRequests).toBe(visibleRequestCount + 1);
});

test("mobile clock stays in its cell and the focused route connector shares the rail axis", async ({ page }) => {
  await page.setViewportSize({ width: 590, height: 844 });
  await gotoHealthy(page, "/");

  const geometry = await page.evaluate(() => {
    const clock = document.querySelector(".live-clock").getBoundingClientRect();
    const clockValue = document.querySelector(".live-clock span:last-child").getBoundingClientRect();
    const focusedStop = document.querySelector(".mobile-route-stop:is(.is-active, .is-terminus)");
    const foldout = document.querySelector(".mobile-active-foldout");
    const railStyle = getComputedStyle(focusedStop, "::before");
    const connectorStyle = getComputedStyle(foldout, "::before");
    const railBox = focusedStop.getBoundingClientRect();
    const foldoutBox = foldout.getBoundingClientRect();
    const nodeBox = focusedStop.querySelector(".mobile-stop-label > i").getBoundingClientRect();
    const foldoutStyle = getComputedStyle(foldout);
    const connectorTransform = new DOMMatrixReadOnly(connectorStyle.transform);

    return {
      clockRight: clock.right,
      clockValueRight: clockValue.right,
      railCenter: railBox.left + Number.parseFloat(railStyle.left) + Number.parseFloat(railStyle.width) / 2,
      nodeCenter: nodeBox.left + nodeBox.width / 2,
      connectorCenter: foldoutBox.left
        + Number.parseFloat(foldoutStyle.borderLeftWidth)
        + Number.parseFloat(connectorStyle.left)
        + Number.parseFloat(connectorStyle.width) / 2
        + connectorTransform.m41,
    };
  });

  expect(geometry.clockValueRight).toBeLessThanOrEqual(geometry.clockRight);
  expect(Math.abs(geometry.nodeCenter - geometry.railCenter)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(geometry.connectorCenter - geometry.railCenter)).toBeLessThanOrEqual(0.5);
});

test("laptop timeline has no viewport guide crossing its content", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await gotoHealthy(page, "/");

  const bodyBackground = await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundImage);

  expect(bodyBackground).not.toContain("90deg");
});

for (const route of ownerRoutes) {
  test(`${route.path} renders the owner surface`, async ({ page }) => {
    await gotoHealthy(page, route.path);

    await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
    if (route.section) await expect(page.getByRole("heading", { level: 2, name: route.section })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Khu vực quản lý" }).getByRole("link", { name: route.currentNav })).toHaveAttribute("aria-current", "page");

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
    await expect(page.locator('body > script[aria-hidden="true"]:not([src])')).toHaveCount(0);
  });
}

test("user management shows the current owner as recently active", async ({ page }) => {
  await gotoHealthy(page, "/admin/users");

  const ownerRow = page.getByRole("row").filter({ hasText: "local-admin@localhost.invalid" });
  await expect(page.getByRole("columnheader", { name: "Hoạt động gần nhất" })).toBeVisible();
  await expect(ownerRow.getByText("JST").last()).toBeVisible();

  const lastActive = await ownerRow.locator("time").last().getAttribute("datetime");
  expect(Date.now() - new Date(lastActive).getTime()).toBeLessThan(6 * 60 * 1000);
});
