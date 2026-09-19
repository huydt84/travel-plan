import { expect, gotoHealthy, itineraryTest as test } from "./fixtures.mjs";

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
  const accountMenuButton = page.getByRole("button", {
    name: "Mở menu tài khoản của Local admin",
  });

  await expect(accountMenuButton).toBeVisible();
  await accountMenuButton.click();
  await expect(page.getByRole("group", { name: "Tài khoản" })).toContainText("Local admin");
});

test("trip selection stays readable beside a long current trip title", async ({ page, request, tripSlug }) => {
  const title = "Silver Week 2026 Tokyo, Kyoto and Osaka";
  expect((await request.patch(`/api/trips/${tripSlug}`, { data: { title } })).status()).toBe(200);

  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await gotoHealthy(page, `/?trip=${tripSlug}`);
    const select = page.getByRole("combobox", { name: "Chọn chuyến đi" });
    await expect(select).toHaveValue(tripSlug);
    const textFits = await select.evaluate((element) => {
      const style = getComputedStyle(element);
      const measure = document.createElement("canvas").getContext("2d");
      measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return measure.measureText(element.selectedOptions[0].textContent).width + 90 < element.clientWidth;
    });
    expect(textFits, `selected trip title should fit at ${width}px`).toBe(true);
    await expect(page.locator(".trip-context .trip-context-actions").getByRole("button", { name: "Chia sẻ" })).toBeVisible();
    await expect(page.locator(".trip-bar").getByRole("button", { name: "Chia sẻ" })).toHaveCount(0);
  }
});

test("public tracker title reflects the current trip state", async ({ page, tripSlug }) => {
  await gotoHealthy(page, `/?trip=${tripSlug}`);

  await expect(page).toHaveTitle(/^(Sắp bắt đầu|Đang diễn ra|Đang chờ|Đã kết thúc) · /);
});

test("active activity uses activity-neutral feedback terminology", async ({ page, tripSlug }) => {
  await page.clock.install({ time: new Date("2030-04-01T00:00:30.000Z") });
  await gotoHealthy(page, `/?trip=${tripSlug}`);

  await expect(page.locator(".now-station .station-actions button")).toHaveText("Góp ý cho hoạt động này");
  await expect(page.locator(".timeline .suggestion-trigger").first()).toHaveText("Góp ý cho hoạt động này");
});

test("reservation activity uses a dedicated icon instead of the visit fallback", async ({ page, request, tripSlug }) => {
  await page.clock.install({ time: new Date("2040-01-01T00:00:00Z") });
  const itinerary = await (await request.get(`/api/trips/${tripSlug}`)).json();
  for (const [index, type, title] of [[0, "Reservation", "Reservation icon probe"], [1, "Visit", "Visit icon probe"]]) {
    expect((await request.patch(`/api/trips/${tripSlug}/schedule/${itinerary.backbone[index].id}`, { data: { type, title } })).status()).toBe(200);
  }
  await gotoHealthy(page, `/?trip=${tripSlug}`);

  const reservationIcon = page.getByRole("heading", { name: "Reservation icon probe", exact: true }).locator("..").locator(".type-icon");
  const visitIcon = page.getByRole("heading", { name: "Visit icon probe", exact: true }).locator("..").locator(".type-icon");
  await expect(reservationIcon).toBeVisible();
  await expect(visitIcon).toBeVisible();
  const [reservationMarkup, visitMarkup] = await Promise.all([reservationIcon.evaluate((icon) => icon.outerHTML), visitIcon.evaluate((icon) => icon.outerHTML)]);
  expect(reservationMarkup, "Reservation must not render the generic location icon").not.toBe(visitMarkup);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("reservation phone directory stays compact and copies the selected number", async ({ page, context, request, tripSlug }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const itinerary = await (await request.get(`/api/trips/${tripSlug}`)).json();
  expect((await request.patch(`/api/trips/${tripSlug}/schedule/${itinerary.backbone[0].id}`, { data: { detail: "Red Lobster — 03-3599-5521\nTGI FRIDAYS — 050-3196-3586" } })).status()).toBe(200);
  await gotoHealthy(page, `/?trip=${tripSlug}`);

  const firstActivity = page.locator(".timeline-item").first();
  const directory = firstActivity.getByLabel("Số điện thoại đặt bàn");
  const redLobsterPhone = directory.getByRole("link", { name: "Gọi Red Lobster theo số 03-3599-5521" });
  const redLobsterCopy = directory.getByRole("button", { name: "Sao chép số điện thoại Red Lobster" });
  await expect(directory).toBeVisible();
  await expect(directory.getByText("TGI FRIDAYS", { exact: true })).toBeVisible();
  await expect(redLobsterPhone).toHaveAttribute("href", "tel:0335995521");
  await expect(redLobsterCopy).toHaveText("");
  await redLobsterCopy.click();
  await expect(directory.getByRole("button", { name: "Đã sao chép số điện thoại Red Lobster" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("03-3599-5521");

  for (const viewport of [{ width: 320, height: 760 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    const geometry = await directory.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const buttons = [...element.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
      return {
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth,
        phoneLinkLefts: [...element.querySelectorAll(".contact-directory-phone")].map((link) => link.getBoundingClientRect().left),
        phoneLinksFullyVisible: [...element.querySelectorAll(".contact-directory-phone")].every((link) => link.scrollWidth <= link.clientWidth + 1),
        smallestButtonWidth: Math.min(...buttons.map((button) => button.width)),
        smallestButtonHeight: Math.min(...buttons.map((button) => button.height)),
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.phoneLinksFullyVisible).toBe(true);
    if (viewport.width >= 1440) {
      expect(Math.max(...geometry.phoneLinkLefts) - Math.min(...geometry.phoneLinkLefts), "phone columns must align across rows").toBeLessThanOrEqual(0.5);
    }
    if (viewport.width === 320) {
      expect(geometry.smallestButtonWidth).toBeGreaterThanOrEqual(44);
      expect(geometry.smallestButtonHeight).toBeGreaterThanOrEqual(44);
    }
  }
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

test("mobile clock stays in its cell and the focused route connector shares the rail axis", async ({ page, tripSlug }) => {
  await page.setViewportSize({ width: 590, height: 844 });
  await gotoHealthy(page, `/?trip=${tripSlug}`);

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

test("mobile active-station title wraps inside its foldout", async ({ page, request, tripSlug }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.clock.install({ time: new Date("2030-04-01T00:00:30.000Z") });
  const itinerary = await (await request.get(`/api/trips/${tripSlug}`)).json();
  expect((await request.patch(`/api/trips/${tripSlug}/schedule/${itinerary.backbone[0].id}`, { data: { title: "Nishifunabashi → Toyosu" } })).status()).toBe(200);
  await gotoHealthy(page, `/?trip=${tripSlug}`);

  const title = page.locator(".mobile-foldout-title h1");
  await expect(title).toHaveText("Nishifunabashi → Toyosu");

  const geometry = await title.evaluate((element) => {
    const row = element.closest(".mobile-foldout-title");
    const foldout = element.closest(".mobile-active-foldout");
    const range = document.createRange();
    range.selectNodeContents(element);

    return {
      rowClientWidth: row.clientWidth,
      rowScrollWidth: row.scrollWidth,
      textRight: range.getBoundingClientRect().right,
      foldoutRight: foldout.getBoundingClientRect().right,
    };
  });

  expect(geometry.rowScrollWidth, "title row must not overflow horizontally").toBeLessThanOrEqual(geometry.rowClientWidth + 1);
  expect(geometry.textRight, "title glyphs must stay inside the foldout border").toBeLessThanOrEqual(geometry.foldoutRight - 1);
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
