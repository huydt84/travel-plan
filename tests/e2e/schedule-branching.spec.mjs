import { expect, gotoHealthy, test } from "./fixtures.mjs";

test("admin creates a branch point and public tracker switches the shared route", async ({ page, request }) => {
  const stamp = Date.now();
  const slug = `branch-e2e-${stamp}`;
  const tripTitle = `Branch E2E ${stamp}`;
  const title = `Điểm rẽ E2E ${stamp}`;

  try {
    const tripResponse = await request.post("/api/trips", { data: { slug, title: tripTitle, startDate: "2020-01-03", endDate: "2020-01-03", timezone: "Asia/Tokyo", location: "Tokyo" } });
    expect(tripResponse.status()).toBe(201);
    for (const activity of [
      { startDate: "2020-01-03", start: "09:00", endDate: "2020-01-03", end: "09:30", type: "Meet", icon: "📍", title: "Tập trung", detail: "Mốc chung", refs: [] },
      { startDate: "2020-01-03", start: "09:45", endDate: "2020-01-03", end: "10:30", type: "Walk", icon: "🚶", title: "Đoạn có thể thay", detail: "Tuyến mặc định", refs: [] },
      { startDate: "2020-01-03", start: "11:00", endDate: "2020-01-03", end: "11:30", type: "Cafe", icon: "☕", title: "Mốc hội nhập", detail: "Mốc chung", refs: [] },
    ]) {
      const scheduleResponse = await request.post(`/api/trips/${slug}/schedule`, { data: activity });
      expect(scheduleResponse.status()).toBe(201);
    }
    const initialResponse = await request.get(`/api/trips/${slug}`);
    expect(initialResponse.ok()).toBeTruthy();
    const initial = await initialResponse.json();
    const anchor = initial.backbone[0];
    const segment = initial.backbone[1];

    const createResponse = await request.post(`/api/trips/${slug}/branches`, {
      data: {
        anchorActivityId: anchor.id,
        segmentActivityIds: [segment.id],
        title,
        defaultBranch: { key: `original-${stamp}`, label: "Tuyến gốc E2E", condition: "Điều kiện bình thường" },
        alternateBranch: { key: `skip-${stamp}`, label: "Bỏ qua E2E", condition: "Khi cần rút ngắn" },
      },
    });
    expect(createResponse.status()).toBe(201);
    const created = await createResponse.json();
    const createdGroup = created.branchGroups.find((group) => group.title === title);
    expect(createdGroup).toBeTruthy();

    await page.setViewportSize({ width: 320, height: 760 });
    await gotoHealthy(page, `/?trip=${slug}`);
    const publicGroup = page.getByRole("region", { name: title });
    const junction = publicGroup.getByRole("button", { name: new RegExp(title) });
    await expect(junction).toBeVisible();
    await junction.click();
    await expect(publicGroup.getByText("Bỏ qua E2E", { exact: true })).toBeVisible();
    const publicActivation = publicGroup.getByRole("button", { name: "Dùng phương án này", exact: true });
    const publicActivationBox = await publicActivation.boundingBox();
    expect(publicActivationBox.height).toBeGreaterThanOrEqual(44);

    page.once("dialog", (dialog) => dialog.accept());
    await publicActivation.click();
    await expect(junction).toContainText("Đang dùng: Bỏ qua E2E");

    await gotoHealthy(page, "/admin/trips");
    await page.getByRole("button", { name: new RegExp(`^${tripTitle}`) }).click();
    const adminGroup = page.getByRole("region", { name: title });
    await expect(adminGroup.getByRole("heading", { name: title })).toBeVisible();
    await expect(adminGroup).toContainText("Đang dùng: Bỏ qua E2E");

    const adminActivation = adminGroup.getByRole("button", { name: "Dùng phương án này", exact: true });
    let dismissedMessage = "";
    page.once("dialog", async (dialog) => {
      dismissedMessage = dialog.message();
      await dialog.dismiss();
    });
    await adminActivation.click();
    expect(dismissedMessage).toContain("Chuyến đi đã bắt đầu");
    await expect(adminGroup).toContainText("Đang dùng: Bỏ qua E2E");

    await page.setViewportSize({ width: 320, height: 760 });
    const adminActivationBox = await adminActivation.boundingBox();
    expect(adminActivationBox.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

    page.once("dialog", (dialog) => dialog.accept());
    await adminActivation.click();
    await expect(adminGroup).toContainText("Đang dùng: Tuyến gốc E2E");
  } finally {
    const cleanup = await request.delete(`/api/trips/${slug}`);
    expect([204, 404]).toContain(cleanup.status());
  }
});

test("admin can branch from the start so the first activity is not forced", async ({ page, request }) => {
  const stamp = Date.now();
  const slug = `start-branch-e2e-${stamp}`;
  const tripTitle = `Start branch E2E ${stamp}`;
  const title = `Điểm rẽ đầu chuyến ${stamp}`;
  let initial;

  try {
    const tripResponse = await request.post("/api/trips", { data: { slug, title: tripTitle, startDate: "2031-01-01", endDate: "2031-01-01", timezone: "Asia/Tokyo", location: "Tokyo" } });
    expect(tripResponse.status()).toBe(201);
    for (const activity of [
      { startDate: "2031-01-01", start: "09:00", endDate: "2031-01-01", end: "10:00", type: "Walk", icon: "🚶", title: "Công viên buổi sáng", detail: "Tuyến ngoài trời", refs: [] },
      { startDate: "2031-01-01", start: "10:30", endDate: "2031-01-01", end: "11:30", type: "Cafe", icon: "☕", title: "Mốc hội nhập", detail: "Hoạt động chung", refs: [] },
      { startDate: "2031-01-01", start: "12:00", endDate: "2031-01-01", end: "13:00", type: "Lunch", icon: "🍜", title: "Ăn trưa", detail: "Hoạt động chung", refs: [] },
    ]) {
      const scheduleResponse = await request.post(`/api/trips/${slug}/schedule`, { data: activity });
      expect(scheduleResponse.status()).toBe(201);
    }
    const initialResponse = await request.get(`/api/trips/${slug}`);
    expect(initialResponse.ok()).toBeTruthy();
    initial = await initialResponse.json();
    const originalFirstId = initial.backbone[0].id;

    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoHealthy(page, "/admin/trips");
    await page.getByRole("button", { name: new RegExp(`^${tripTitle}`) }).click();
    await page.getByRole("button", { name: "Tạo điểm rẽ từ đầu", exact: true }).click();
    const creator = page.locator(".branch-create-editor.is-trip-start");
    await expect(creator.getByRole("heading", { name: "Tạo điểm rẽ từ đầu chuyến" })).toBeVisible();
    await creator.getByLabel("Tên điểm rẽ").fill(title);
    await creator.getByLabel("Tên phương án mặc định").fill("Sáng khô ráo");
    await creator.getByLabel("Điều kiện", { exact: true }).nth(0).fill("Không mưa từ lúc khởi hành");
    await creator.getByLabel("Tên phương án dự phòng").fill("Sáng có mưa");
    await creator.getByLabel("Điều kiện", { exact: true }).nth(1).fill("Mưa từ lúc khởi hành");
    await creator.getByRole("button", { name: "Chuyển 1 hoạt động đầu tiên thành điểm rẽ", exact: true }).click();

    const adminGroup = page.getByRole("region", { name: title });
    await expect(adminGroup).toBeVisible();
    await expect(adminGroup).toContainText("Điểm rẽ đầu chuyến");

    const createdResponse = await request.get(`/api/trips/${slug}`);
    expect(createdResponse.ok()).toBeTruthy();
    const created = await createdResponse.json();
    const createdGroup = created.branchGroups.find((group) => group.title === title);
    expect(createdGroup.anchorActivityId).toBeNull();
    expect(created.itinerary[0].id).toBe(originalFirstId);
    expect(created.backbone[0].id).not.toBe(originalFirstId);

    await gotoHealthy(page, `/?trip=${slug}`);
    const geometry = await page.evaluate(() => {
      const junction = document.querySelector(".branch-junction.is-trip-start");
      const firstActivity = document.querySelector(".timeline-segment");
      return {
        junctionTop: Math.round(junction.getBoundingClientRect().top),
        firstActivityTop: Math.round(firstActivity.getBoundingClientRect().top),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(geometry.junctionTop).toBeLessThan(geometry.firstActivityTop);
    expect(geometry.documentWidth).toBe(geometry.viewportWidth);
  } finally {
    const cleanup = await request.delete(`/api/trips/${slug}`);
    expect([204, 404]).toContain(cleanup.status());
  }
});

async function openBranchFixture(page) {
  const slug = `branch-controls-${Date.now()}`;
  const title = `Branch controls ${Date.now()}`;
  expect((await page.request.post("/api/trips", { data: { slug, title, startDate: "2030-01-01", endDate: "2030-01-01", timezone: "Asia/Tokyo", location: "Tokyo" } })).status()).toBe(201);
  for (let i=0;i<3;i++) expect((await page.request.post(`/api/trips/${slug}/schedule`, { data: { startDate: "2030-01-01", start: `${String(9+i).padStart(2,"0")}:00`, endDate: "2030-01-01", end: `${String(10+i).padStart(2,"0")}:00`, type: "Visit", icon: "pin", title: `Branch stop ${i}`, detail: "", refs: [] } })).status()).toBe(201);
  await gotoHealthy(page, "/admin/trips");
  await page.getByRole("button", { name: new RegExp(`^${title}`) }).click();
  await expect(page.locator(".admin-branch-entry")).toHaveCount(2);
  return async () => { expect((await page.request.delete(`/api/trips/${slug}`)).status()).toBe(204); };
}

test("branch creation controls stay within a 320px admin viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  const cleanup = await openBranchFixture(page);
  try {
  await page.getByRole("button", { name: "Tạo điểm rẽ sau mục này", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: /Tạo điểm rẽ sau/ })).toBeVisible();
  const width = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(width.document).toBe(width.viewport);
  } finally { await cleanup(); }
});

for (const viewport of [
  { name: "phone", width: 320, height: 760 },
  { name: "macbook", width: 1440, height: 900 },
  { name: "dell", width: 1920, height: 1080 },
]) {
  test(`${viewport.name} branch creation actions clear the preceding separator`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const cleanup = await openBranchFixture(page);
    try {

    const gaps = await page.evaluate(() => [...document.querySelectorAll(".admin-branch-entry")].map((entry) => {
      const button = entry.querySelector("button");
      const precedingActivity = entry.previousElementSibling;
      return Math.round(button.getBoundingClientRect().top - precedingActivity.getBoundingClientRect().bottom);
    }));

    expect(gaps.length).toBeGreaterThan(0);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(8);
    } finally { await cleanup(); }
  });
}

for (const viewport of [
  { name: "phone", width: 320, height: 760 },
  { name: "macbook", width: 1440, height: 900 },
  { name: "dell", width: 1920, height: 1080 },
]) {
  test(`${viewport.name} activity editor uses guided controls and the available space`, async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      window.__scheduleTimePickerCalls = 0;
      HTMLInputElement.prototype.showPicker = function showPicker() {
        window.__scheduleTimePickerCalls += 1;
      };
    });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoHealthy(page, "/admin/trips?trip=kamakura-2026-08-09");
    await page.getByRole("button", { name: /Thêm hoạt động vào/ }).first().click();

    const editor = page.locator(".schedule-inline-editor");
    await expect(editor).toBeVisible();
    const typeSelect = editor.getByLabel("Loại");
    const iconSelect = editor.getByLabel("Icon");
    await expect(typeSelect).toHaveJSProperty("tagName", "SELECT");
    await expect(iconSelect).toHaveJSProperty("tagName", "SELECT");
    await typeSelect.selectOption("Walk");
    await expect(iconSelect).toHaveValue("🚶");
    await typeSelect.selectOption("Visit");
    await expect(iconSelect).toHaveValue("📍");
    await editor.getByLabel("Bắt đầu", { exact: true }).click({ position: { x: 12, y: 12 } });
    await expect.poll(() => page.evaluate(() => window.__scheduleTimePickerCalls)).toBe(1);

    const geometry = await editor.evaluate((form) => {
      const group = form.closest(".admin-branch-group");
      const formRect = form.getBoundingClientRect();
      const groupRect = group.getBoundingClientRect();
      const controls = [...form.querySelectorAll(".schedule-form-grid > label")].map((label) => {
        const control = label.querySelector("input, select, textarea");
        const rect = control.getBoundingClientRect();
        return { label: label.childNodes[0]?.textContent?.trim(), top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
      });
      const overlaps = controls.flatMap((control, index) => controls.slice(index + 1)
        .filter((other) => control.left < other.right && control.right > other.left && control.top < other.bottom && control.bottom > other.top)
        .map((other) => `${control.label}/${other.label}`));
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        formWidth: Math.round(formRect.width),
        formHeight: Math.round(formRect.height),
        groupWidth: Math.round(groupRect.width),
        columns: getComputedStyle(form).gridTemplateColumns.split(" ").filter(Boolean).length,
        selectFontSize: Number.parseFloat(getComputedStyle(form.querySelector("select")).fontSize),
        overlaps,
      };
    });

    expect(geometry.documentWidth).toBe(geometry.viewportWidth);
    expect(geometry.overlaps).toEqual([]);
    if (viewport.name !== "phone") {
      expect(geometry.formWidth).toBeGreaterThanOrEqual(Math.round(geometry.groupWidth * 0.85));
      expect(geometry.formHeight).toBeLessThan(760);
      expect(geometry.columns).toBeGreaterThanOrEqual(2);
    } else {
      expect(geometry.formWidth).toBeGreaterThanOrEqual(Math.round(geometry.groupWidth * 0.85));
      expect(geometry.selectFontSize).toBeGreaterThanOrEqual(16);
    }

    await editor.screenshot({ path: testInfo.outputPath("branch-editor.png") });
    await editor.getByLabel("Tiêu đề").fill("Unsaved branch draft");
    await editor.getByRole("button", { name: "Hủy", exact: true }).first().click();
    const discard = page.getByRole("dialog", { name: "Bỏ thay đổi chưa lưu?" });
    await expect(discard).toBeVisible();
    await expect(discard.getByRole("button", { name: "Tiếp tục sửa" })).toBeFocused();
    await discard.screenshot({ path: testInfo.outputPath("discard-draft.png") });
    await page.keyboard.press("Escape");
    await expect(discard).not.toBeVisible();
    await expect(editor.getByLabel("Tiêu đề")).toHaveValue("Unsaved branch draft");
    await editor.getByRole("button", { name: "Hủy", exact: true }).first().click();
    await discard.getByRole("button", { name: "Bỏ thay đổi", exact: true }).click();
    await expect(editor).not.toBeVisible();
    await expect(page.getByRole("button", { name: /Thêm hoạt động vào/ }).first()).toBeFocused();
    await page.getByRole("button", { name: "Thêm hoạt động", exact: true }).click();
    const backboneEditor = page.locator(".schedule-create-editor");
    await expect(backboneEditor).toBeVisible();
    await expect(backboneEditor.getByLabel("Loại")).toHaveJSProperty("tagName", "SELECT");
    await expect(backboneEditor.getByLabel("Icon")).toHaveJSProperty("tagName", "SELECT");
    const backboneGeometry = await backboneEditor.evaluate((form) => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      height: Math.round(form.getBoundingClientRect().height),
      columns: getComputedStyle(form).gridTemplateColumns.split(" ").filter(Boolean).length,
    }));
    await backboneEditor.screenshot({ path: testInfo.outputPath("backbone-editor.png") });
    expect(backboneGeometry.documentWidth).toBe(backboneGeometry.viewportWidth);
    if (viewport.name !== "phone") {
      expect(backboneGeometry.height).toBeLessThan(760);
      expect(backboneGeometry.columns).toBeGreaterThanOrEqual(2);
    }
  });
}

for (const viewport of [
  { name: "macbook", width: 1440, height: 900 },
  { name: "dell", width: 1920, height: 1080 },
]) {
  test(`${viewport.name} branching keeps a continuous rail and compact parallel alternatives`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoHealthy(page, "/?trip=kamakura-2026-08-09");

    const junction = page.locator(".branch-junction").first();
    await expect(junction).toBeVisible();
    const summary = junction.locator(".branch-junction-summary");
    if (await summary.getAttribute("aria-expanded") !== "true") await summary.click();

    const layout = await page.evaluate(() => {
      const segments = [...document.querySelectorAll(".timeline-segment")];
      const railDisplays = segments.map((segment) => getComputedStyle(segment.querySelector(".timeline-rail"), "::after").display);
      const platforms = document.querySelector(".branch-platforms");
      const platformStyle = getComputedStyle(platforms);
      // Other E2E cases append notes to the first activity on this shared trip.
      // Measure the short transfer buffer instead so this remains a layout check.
      const simpleItem = [...document.querySelectorAll(".timeline-item")]
        .find((item) => item.querySelector("h3")?.textContent === "JR Kamakura → Enoden Kamakura EN15");
      return {
        nonFinalRails: railDisplays.slice(0, -1),
        finalRail: railDisplays.at(-1),
        platformDisplay: platformStyle.display,
        platformColumns: platformStyle.gridTemplateColumns.split(" ").filter(Boolean).length,
        simpleItemHeight: Math.round(simpleItem.getBoundingClientRect().height),
        suggestionHeight: Math.round(simpleItem.querySelector(".suggestion-trigger").getBoundingClientRect().height),
        branchButtonHeight: Math.round(platforms.querySelector(".branch-select-button").getBoundingClientRect().height),
      };
    });

    expect(layout.nonFinalRails).not.toContain("none");
    expect(layout.finalRail).toBe("none");
    expect(layout.platformDisplay).toBe("grid");
    expect(layout.platformColumns).toBeGreaterThanOrEqual(2);
    // The owner-facing expense controls add one compact row to this card.
    expect(layout.simpleItemHeight).toBeLessThan(260);
    expect(layout.suggestionHeight).toBeLessThan(44);
    expect(layout.branchButtonHeight).toBeLessThan(44);

    await gotoHealthy(page, "/admin/trips?trip=kamakura-2026-08-09");
    const adminLayout = await page.evaluate(() => {
      const group = document.querySelector(".admin-branch-group");
      const options = group.querySelector(".admin-branch-options");
      const style = getComputedStyle(options);
      const activityHeights = [...group.querySelectorAll(".admin-branch-activities .admin-schedule-item")]
        .map((item) => Math.round(item.getBoundingClientRect().height));
      const optionHeadHeights = [...group.querySelectorAll(".admin-branch-option-head")]
        .map((head) => Math.round(head.getBoundingClientRect().height));
      return {
        display: style.display,
        columns: style.gridTemplateColumns.split(" ").filter((column) => column !== "0px").length,
        maxActivityHeight: Math.max(0, ...activityHeights),
        maxOptionHeadHeight: Math.max(0, ...optionHeadHeights),
      };
    });
    expect(adminLayout.display).toBe("grid");
    expect(adminLayout.columns).toBeGreaterThanOrEqual(2);
    expect(adminLayout.maxActivityHeight).toBeLessThan(180);
    expect(adminLayout.maxOptionHeadHeight).toBeLessThan(150);
  });
}

test("mobile branch accordion spans the route and reconnects on the rail axis", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await gotoHealthy(page, "/?trip=kamakura-2026-08-09");

  const geometry = await page.evaluate(() => {
    const group = document.querySelector(".branch-junction");
    const anchor = group.closest(".timeline-segment").querySelector(".timeline-rail");
    const groupRect = group.getBoundingClientRect();
    const railRect = anchor.getBoundingClientRect();
    const connector = getComputedStyle(group, "::before");
    const pixels = (value) => Number(value.replace("px", ""));
    return {
      groupWidth: Math.round(groupRect.width),
      railAxis: railRect.left + railRect.width / 2,
      connectorStart: groupRect.left + pixels(connector.left),
      connectorEnd: groupRect.left + pixels(connector.left) + pixels(connector.width),
      documentWidth: document.documentElement.scrollWidth,
    };
  });

  expect(geometry.groupWidth).toBeGreaterThanOrEqual(280);
  expect(geometry.railAxis).toBeGreaterThanOrEqual(geometry.connectorStart);
  expect(geometry.railAxis).toBeLessThanOrEqual(geometry.connectorEnd);
  expect(geometry.documentWidth).toBe(320);
});
