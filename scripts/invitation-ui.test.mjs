import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../components/UserManagementApp.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("invitation UI supports a selected trip plus typed and known-user recipients", () => {
  assert.match(component, /id="invitation-trip"/);
  assert.match(component, /fetch\(`\/api\/trips\/\$\{encodeURIComponent\(tripSlug\)\}\/schedule`/);
  assert.match(component, /type="email"/);
  assert.match(component, /type="checkbox"/);
  assert.match(component, /fetch\("\/api\/invitations"/);
  assert.match(component, /crypto\.randomUUID\(\)/);
  assert.match(component, /<strong>\{pendingRecipientCount\} lời rủ<\/strong>/);
  assert.match(component, /Mỗi người nhận một email riêng với lịch trình đầy đủ/);
});

test("invitation UI exposes an editable, resettable email draft", () => {
  assert.match(component, /id="invitation-subject"/);
  assert.match(component, /id="invitation-message"/);
  assert.match(component, /createInvitationDraft/);
  assert.match(component, /Tạo lại từ lịch trình/);
  assert.match(component, /Đã chỉnh sửa thủ công/);
  assert.match(component, /subject: draft\.subject/);
  assert.match(component, /message: draft\.message/);
});

test("invitation UI exposes accessible status, errors, controls, and loading state", () => {
  assert.match(component, /role="alert"/);
  assert.match(component, /role="status"/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /disabled=\{busy \|\| draftLoading \|\| pendingRecipientCount === 0 \|\| !loadedPlan\}/);
  assert.match(component, /Đang gửi…/);
});

test("invitation dispatch board preserves the admin visual system and mobile reflow", () => {
  assert.match(styles, /\.admin-invitations \{/);
  assert.match(styles, /\.invitation-form \{ display: grid;/);
  assert.match(styles, /\.invitation-user-option:has\(input:checked\)/);
  assert.match(styles, /\.invitation-draft \{ grid-column: 1 \/ -1;/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.invitation-form \{ grid-template-columns: 1fr;/);
});
