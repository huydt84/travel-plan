import { randomUUID } from "node:crypto";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { expect, gotoHealthy, test } from "./fixtures.mjs";

const localHeaders = (email, name) => ({
  "x-local-viewer-email": email,
  "x-local-viewer-name": name,
});

test("users can change their display name and the owner can change it for them", async ({ browser, baseURL }) => {
  const marker = randomUUID();
  const email = `display-name-${marker}@localhost.invalid`;
  const googleName = "Google Name";
  const memberContext = await browser.newContext({ baseURL, extraHTTPHeaders: localHeaders(email, googleName) });
  const ownerContext = await browser.newContext({ baseURL });
  const memberPage = await memberContext.newPage();
  const ownerPage = await ownerContext.newPage();
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);

  try {
    await gotoHealthy(memberPage, "/requests");
    await memberPage.getByRole("button", { name: `Mở menu tài khoản của ${googleName}` }).click();
    await memberPage.getByRole("button", { name: "Đổi tên hiển thị", exact: true }).click();
    const profileDialog = memberPage.getByRole("dialog", { name: "Đổi tên hiển thị" });
    await profileDialog.getByRole("textbox", { name: "Tên hiển thị" }).fill("Tên do tôi chọn");
    await profileDialog.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
    await expect(memberPage.getByRole("button", { name: "Mở menu tài khoản của Tên do tôi chọn" })).toBeVisible();

    await gotoHealthy(ownerPage, "/admin/users");
    const row = ownerPage.locator(".admin-users-table tbody tr").filter({ hasText: email });
    await expect(row).toContainText("Tên do tôi chọn");
    await row.getByRole("button", { name: "Đổi tên", exact: true }).click();
    const ownerDialog = ownerPage.getByRole("dialog", { name: "Đổi tên hiển thị" });
    await ownerDialog.getByRole("textbox", { name: "Tên hiển thị" }).fill("Tên do owner chọn");
    await ownerDialog.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
    await expect(row).toContainText("Tên do owner chọn");

    await memberPage.goto(`${baseURL}/requests`);
    await expect(memberPage.getByRole("button", { name: "Mở menu tài khoản của Tên do owner chọn" })).toBeVisible();
    expect((await memberContext.request.patch(`/api/admin/users/${encodeURIComponent(email)}`, {
      data: { displayName: "Member must not edit others" },
    })).status()).toBe(403);
  } finally {
    await sql`DELETE FROM users WHERE email=${email}`;
    await sql.end();
    await memberContext.close();
    await ownerContext.close();
  }
});
