import { expect, permissionTest as test } from "./permission-fixture.mjs";

test("expense ledger enforces permissions, identity, totals, audit and deletion guards", async ({ request, permissionFixture: f }) => {
  const endpoint = `/api/trips/${f.slug}/expenses`;
  const activity = f.plan.backbone[0];

  const initial = await request.get(endpoint, { headers: f.headers.member });
  expect(initial.status()).toBe(200);
  const initialBody = await initial.json();
  expect(initialBody).toMatchObject({ currency: "JPY", canManage: false, payers: [], summary: { totalAmount: "0", averageAmount: "0", participantCount: 2 } });
  expect(initialBody.summary.members.every((member) => !("email" in member))).toBe(true);

  const payload = { activityId: activity.id, payerEmail: f.people.member.email, amount: "100" };
  expect((await request.post(endpoint, { headers: f.headers.anonymous, data: payload })).status()).toBe(401);
  expect((await request.post(endpoint, { headers: f.headers.outsider, data: payload })).status()).toBe(404);
  expect((await request.post(endpoint, { headers: f.headers.member, data: payload })).status()).toBe(403);
  expect((await request.post(endpoint, { headers: f.headers.leader, data: { ...payload, amount: "1.5" } })).status()).toBe(400);
  expect((await request.post(endpoint, { headers: f.headers.leader, data: { ...payload, payerEmail: f.people.outsider.email } })).status()).toBe(400);

  const created = await request.post(endpoint, { headers: f.headers.leader, data: payload });
  expect(created.status()).toBe(201);
  const expenseId = (await created.json()).id;

  const memberView = await (await request.get(endpoint, { headers: f.headers.member })).json();
  expect(memberView.expenses[0]).toMatchObject({ id: expenseId, amount: "100", payer: { displayName: f.people.member.name }, createdBy: { displayName: f.people.leader.name } });
  expect(memberView.expenses[0].payer.email).toBeUndefined();
  expect(memberView.summary).toMatchObject({ totalAmount: "100", averageAmount: "50" });
  expect(memberView.summary.members.find((member) => member.displayName === f.people.member.name)).toMatchObject({ totalAmount: "100", differenceAmount: "50", comparison: "more" });

  const permissionEndpoint = `/api/trips/${f.slug}/members/${encodeURIComponent(f.people.member.email)}/expense-permission`;
  expect((await request.put(permissionEndpoint, { headers: f.headers.member, data: { canManageExpenses: true } })).status()).toBe(403);
  expect((await request.put(permissionEndpoint, { headers: f.headers.leader, data: { canManageExpenses: true } })).status()).toBe(200);
  expect((await request.patch(`${endpoint}/${expenseId}`, { headers: f.headers.member, data: { amount: "60" } })).status()).toBe(200);

  const memberManaged = await (await request.get(endpoint, { headers: f.headers.member })).json();
  expect(memberManaged.canManage).toBe(true);
  expect(memberManaged.payers).toHaveLength(2);
  expect(memberManaged.summary).toMatchObject({ totalAmount: "60", averageAmount: "30" });

  const branchResponse = await request.post(`/api/trips/${f.slug}/branches`, { headers: f.headers.leader, data: {
    anchorActivityId: f.plan.backbone[0].id,
    segmentActivityIds: [f.plan.backbone[1].id],
    title: "Expense branch",
    defaultBranch: { key: `expense-default-${f.marker}`, label: "Default", condition: "Normal" },
    alternateBranch: { key: `expense-alternate-${f.marker}`, label: "Alternate", condition: "Backup" },
  } });
  expect(branchResponse.status()).toBe(201);
  const branchGroup = (await branchResponse.json()).branchGroups.find((group) => group.title === "Expense branch");
  const inactiveBranch = branchGroup.branches.find((branch) => !branch.isDefault);
  const inactiveActivityResponse = await request.post(`/api/trips/${f.slug}/schedule`, { headers: f.headers.leader, data: {
    branchId: inactiveBranch.id, startDate: "2032-04-01", start: "10:00", endDate: "2032-04-01", end: "11:00",
    type: "Visit", icon: "📍", title: "Inactive expense activity", detail: "Not selected", refs: [],
  } });
  expect(inactiveActivityResponse.status()).toBe(201);
  const inactiveActivity = await inactiveActivityResponse.json();
  const inactiveExpenseResponse = await request.post(endpoint, { headers: f.headers.member, data: {
    activityId: inactiveActivity.id, payerEmail: f.people.leader.email, amount: "40",
  } });
  expect(inactiveExpenseResponse.status()).toBe(201);
  const inactiveExpenseId = (await inactiveExpenseResponse.json()).id;
  const withInactiveBranch = await (await request.get(endpoint, { headers: f.headers.member })).json();
  expect(withInactiveBranch.summary).toMatchObject({ totalAmount: "100", averageAmount: "50" });
  expect(withInactiveBranch.summary.activityTotals[inactiveActivity.id]).toBe("40");

  expect((await request.patch(`/api/trips/${f.slug}`, { headers: f.headers.leader, data: { currency: "USD" } })).status()).toBe(409);
  expect((await request.delete(`/api/trips/${f.slug}/members/${encodeURIComponent(f.people.member.email)}`, { headers: f.headers.leader })).status()).toBe(409);
  expect((await request.delete(`/api/trips/${f.slug}/schedule/${inactiveActivity.id}`, { headers: f.headers.leader })).status()).toBe(409);

  expect((await request.get(endpoint, { headers: f.headers.admin })).status()).toBe(200);
  expect((await request.get(endpoint, { headers: f.headers.owner })).status()).toBe(200);
  const audit = await (await request.get(`/api/admin/trips/${f.slug}/audit`, { headers: f.headers.admin })).json();
  expect(audit.events.map((event) => event.action)).toEqual(expect.arrayContaining(["expense.created", "expense.updated", "expense.permission_changed"]));

  expect((await request.delete(`${endpoint}/${inactiveExpenseId}`, { headers: f.headers.member })).status()).toBe(204);
  expect((await request.delete(`${endpoint}/${expenseId}`, { headers: f.headers.member })).status()).toBe(204);
  const promoteMemberEndpoint = `/api/trips/${f.slug}/members/${encodeURIComponent(f.people.member.email)}/leader`;
  const restoreLeaderEndpoint = `/api/trips/${f.slug}/members/${encodeURIComponent(f.people.leader.email)}/leader`;
  expect((await request.put(promoteMemberEndpoint, { headers: f.headers.leader })).status()).toBe(200);
  expect((await (await request.get(endpoint, { headers: f.headers.leader })).json()).canManage).toBe(false);
  expect((await (await request.get(endpoint, { headers: f.headers.member })).json()).canManage).toBe(true);
  expect((await request.put(restoreLeaderEndpoint, { headers: f.headers.member })).status()).toBe(200);
  expect((await (await request.get(endpoint, { headers: f.headers.member })).json()).canManage).toBe(false);
  expect((await request.post(endpoint, { headers: f.headers.member, data: payload })).status()).toBe(403);
});

test("expense controls remain usable on the canonical public and admin viewports", async ({ browser, permissionFixture: f }, testInfo) => {
  for (const viewport of [{ width: 320, height: 760 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    const context = await browser.newContext({ viewport, extraHTTPHeaders: f.headers.leader });
    const page = await context.newPage();
    await page.goto(`/?trip=${f.slug}`);
    await expect(page.getByRole("heading", { name: "Tổng quan chi tiêu" })).toBeVisible();
    const expenseToggle = page.getByRole("button", { name: /Mở chi tiêu của Matrix start/ });
    await expect(expenseToggle).toHaveAttribute("aria-expanded", "false");
    const section = page.getByRole("button", { name: "Thêm khoản chi cho Matrix start" }).locator("xpath=ancestor::section[1]");
    const sectionBox = await section.boundingBox();
    const titleBox = await section.locator("xpath=preceding-sibling::h3[1]").boundingBox();
    expect(Math.abs(sectionBox.x - titleBox.x)).toBeLessThan(1);
    expect(sectionBox.height).toBeLessThanOrEqual(52);
    expect(await section.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("0px");
    const innerWidth = await section.evaluate((element) => {
      const parent = element.parentElement;
      const style = getComputedStyle(parent);
      return parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
    expect(Math.abs(sectionBox.width - innerWidth)).toBeLessThan(1);
    if (viewport.width === 320) {
      await page.getByRole("button", { name: "Thêm khoản chi cho Matrix start" }).click();
      const dialog = page.getByRole("dialog", { name: "Thêm khoản chi" });
      await expect(dialog.locator('[title="Bắt buộc"]')).toHaveCount(2);
      await dialog.getByLabel("Người chi").selectOption({ label: f.people.member.name });
      await dialog.getByLabel(/Số tiền/).fill("125");
      await dialog.getByRole("button", { name: "Lưu thay đổi" }).click();
      await expect(page.getByRole("status", { name: "" }).filter({ hasText: "Đã lưu khoản chi." })).toBeVisible();
      await expect(page.getByRole("button", { name: /Thu gọn chi tiêu của Matrix start/ })).toContainText(/125.*¥|¥.*125/);
      const more = page.getByRole("button", { name: `Thêm thao tác với Chi tiêu của ${f.people.member.name}` });
      await expect(more).toBeVisible();
      const box = await more.boundingBox();
      expect(box?.width).toBe(44);
      expect(box?.height).toBe(44);
      await more.focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("menuitem", { name: "Sửa" })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("menuitem", { name: "Xóa" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(more).toBeFocused();
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Thu gọn chi tiêu của Matrix start/ })).toHaveAttribute("aria-expanded", "true");
      await more.evaluate((button) => button.blur());
    } else {
      await expect(expenseToggle.locator("svg")).toHaveCount(1);
      await expenseToggle.click();
    }
    await page.screenshot({ path: testInfo.outputPath(`public-expenses-${viewport.width}.png`), fullPage: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: f.headers.admin });
  const page = await context.newPage();
  await page.goto(`/admin/trips?trip=${f.slug}`);
  await expect(page.getByRole("heading", { name: "Tổng quan chi tiêu" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Chi tiêu theo hoạt động" })).toHaveCount(0);
  const adminExpenseToggle = page.getByRole("button", { name: /Mở chi tiêu của Matrix start/ });
  await expect(adminExpenseToggle).toHaveCount(1);
  const adminActivity = page.getByRole("heading", { name: "Matrix start" }).locator("xpath=ancestor::article[1]");
  await adminExpenseToggle.click();
  await expect(adminActivity.getByRole("heading", { name: "Matrix start" })).toBeVisible();
  await expect(adminActivity.getByText(/125.*¥|¥.*125/).last()).toBeVisible();
  await expect(page.getByText("Quản lý chi tiêu", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("admin-expenses-1440.png"), fullPage: false });
  await context.close();
});

test("expense menu keeps totals and CRUD usable from a collapsed module", async ({ browser, permissionFixture: f }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 760 }, extraHTTPHeaders: f.headers.leader });
  const page = await context.newPage();
  await page.goto(`/?trip=${f.slug}`);
  const section = page.getByRole("button", { name: "Thêm khoản chi cho Matrix start" }).locator("xpath=ancestor::section[1]");
  await section.getByRole("button", { name: "Thêm khoản chi cho Matrix start" }).click();
  const dialog = page.getByRole("dialog", { name: "Thêm khoản chi" });
  await dialog.getByLabel("Người chi").selectOption({ label: f.people.member.name });
  await dialog.getByLabel(/Số tiền/).fill("125");
  await dialog.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(section).toContainText(/125.*¥|¥.*125/);
  await expect(section).toContainText("· 1");
  const more = section.getByRole("button", { name: /Thêm thao tác với Chi tiêu/ });
  await more.click();
  await page.getByRole("menuitem", { name: "Sửa" }).click();
  const editDialog = page.getByRole("dialog", { name: "Sửa khoản chi" });
  await editDialog.getByLabel(/Số tiền/).fill("250");
  await editDialog.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(section).toContainText(/250.*¥|¥.*250/);
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole("menuitem", { name: "Xóa" }).click();
  await expect(page.getByRole("alertdialog", { name: "Xóa khoản chi này?" })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Huỷ" }).click();
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole("menuitem", { name: "Xóa" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Xóa" }).click();
  await expect(section).toContainText("· 0");
  await expect(section).toContainText("Chưa có khoản chi cho hoạt động này.");
  await expect(section.getByRole("button", { name: /Thu gọn chi tiêu của Matrix start/ })).toBeFocused();
  await section.getByRole("button", { name: "Thêm khoản chi cho Matrix start" }).click();
  await dialog.getByLabel("Người chi").selectOption({ label: f.people.member.name });
  await dialog.getByLabel(/Số tiền/).fill("125");
  await dialog.getByRole("button", { name: "Lưu thay đổi" }).click();
  await section.getByRole("button", { name: "Thêm khoản chi cho Matrix start" }).click();
  await dialog.getByLabel("Người chi").selectOption({ label: f.people.leader.name });
  await dialog.getByLabel(/Số tiền/).fill("123456789");
  await dialog.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(section).toContainText("· 2");
  await expect(section.locator('[class*="expenseRow"]')).toHaveCount(2);
  await f.sql`UPDATE users SET display_name='A very long payer description that must wrap within the expense row without moving its amount or action' WHERE email=${f.people.member.email}`;
  await page.reload();
  await page.getByRole("button", { name: /Mở chi tiêu của Matrix start/ }).click();
  const row = section.locator('[class*="expenseRow"]').filter({ hasText: "A very long payer description" });
  await expect(row).toContainText("A very long payer description");
  const rowBox = await row.boundingBox();
  const amountBox = await row.locator('[class*="expenseAmount"]').boundingBox();
  const actionBox = await row.getByRole("button", { name: /Thêm thao tác/ }).boundingBox();
  expect(amountBox.x + amountBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
  expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await context.close();
});
