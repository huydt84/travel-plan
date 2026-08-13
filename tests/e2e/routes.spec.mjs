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
    section: "Lịch sử đăng nhập",
    currentNav: "Người dùng",
  },
];

test("public tracker renders its primary controls", async ({ page }) => {
  await gotoHealthy(page, "/");

  await expect(page.getByRole("combobox", { name: "Chọn chuyến đi" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rủ bạn đi cùng", exact: true })).toBeVisible();
  await expect(page.getByText("Local admin", { exact: true })).toBeVisible();
});

test("mobile clock stays in its cell and the active route connector shares the rail axis", async ({ page }) => {
  await page.setViewportSize({ width: 590, height: 844 });
  await gotoHealthy(page, "/");

  const geometry = await page.evaluate(() => {
    const clock = document.querySelector(".live-clock").getBoundingClientRect();
    const clockValue = document.querySelector(".live-clock span:last-child").getBoundingClientRect();
    const activeStop = document.querySelector(".mobile-route-stop.is-active");
    const foldout = document.querySelector(".mobile-active-foldout");
    const railStyle = getComputedStyle(activeStop, "::before");
    const connectorStyle = getComputedStyle(foldout, "::before");
    const railBox = activeStop.getBoundingClientRect();
    const foldoutBox = foldout.getBoundingClientRect();
    const nodeBox = activeStop.querySelector(".mobile-stop-label > i").getBoundingClientRect();
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
