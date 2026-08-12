import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dialog, tracker, viewerMenu, admin, tripsAdmin, users, styles] = await Promise.all([
  readFile(new URL("../components/InvitationDialog.jsx", import.meta.url), "utf8"),
  readFile(new URL("../components/TripTracker.jsx", import.meta.url), "utf8"),
  readFile(new URL("../components/ViewerMenu.jsx", import.meta.url), "utf8"),
  readFile(new URL("../components/InvitationAdminApp.jsx", import.meta.url), "utf8"),
  readFile(new URL("../components/AdminApp.jsx", import.meta.url), "utf8"),
  readFile(new URL("../components/UserManagementApp.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
]);

test("trip admin forwards invitation badge state into the owner dashboard", () => {
  assert.match(tripsAdmin, /<Dashboard[\s\S]*pendingInvitationCount=\{pendingInvitationCount\}/);
  assert.match(tripsAdmin, /function Dashboard\(\{[^}]*pendingInvitationCount[^}]*\}\)/);
});

test("public tracker owns the invitation entry point and responsive sheet", () => {
  assert.match(tracker, /<div className="trip-context">[\s\S]*className="admin-link invite-link"/);
  assert.match(tracker, /className="admin-link invite-link"/);
  assert.match(tracker, />Rủ bạn đi cùng</);
  assert.match(tracker, /<InvitationDialog/);
  assert.match(dialog, /createPortal\(/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(styles, /\.invitation-sheet \{[^}]*max-height: 80dvh/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.invitation-sheet \{[^}]*max-height: 92dvh/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.trip-context \.invite-link \{[^}]*min-height: 44px/);
});

test("account disclosure separates owner navigation from sign out", () => {
  assert.match(tracker, /className="viewer-utilities"/);
  assert.match(tracker, /className="admin-link desktop-manage-link"/);
  assert.match(viewerMenu, /aria-expanded=\{open\}/);
  assert.match(viewerMenu, /aria-controls=\{MENU_ID\}/);
  assert.match(viewerMenu, /Mở menu tài khoản của/);
  assert.match(viewerMenu, /manageClassName = localDev \? "viewer-menu-item" : "viewer-menu-item mobile-manage-link"/);
  assert.match(viewerMenu, />\s*Đăng xuất\s*</);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.desktop-manage-link \{ display: none; \}[\s\S]*\.mobile-manage-link \{ display: flex; \}/);
});

test("permission states do not mount the composer before approval", () => {
  assert.match(dialog, /permissionStatus === "not_requested"/);
  assert.match(dialog, /permissionStatus === "pending"/);
  assert.match(dialog, /\["denied", "revoked"\]\.includes/);
  assert.match(dialog, /const approved = permissionStatus === "approved"/);
  assert.match(dialog, /return \(\s*<form className="invitation-sheet-form"/);
  assert.match(dialog, /Yêu cầu quyền gửi lời rủ/);
  assert.match(dialog, /Quyền gửi lời rủ đã bị thu hồi/);
  assert.match(dialog, /!isOwner && <ol className="invitation-permission-route"/);
  assert.match(dialog, /viewer\?\.isOwner \|\| access\?\.isOwner/);
  assert.match(dialog, /Không tải được quyền gửi lời rủ/);
  assert.match(dialog, /Thử tải lại/);
});

test("incremental Gmail flow preserves and restores a compact draft", () => {
  assert.match(dialog, /window\.sessionStorage\.setItem\(draftKey/);
  assert.match(dialog, /saveDraft\(sendingTo\)/);
  assert.match(dialog, /connectGmail\(sendingTo\)/);
  assert.match(dialog, /DRAFT_TTL_MS = 30 \* 60 \* 1000/);
  assert.match(dialog, /scope: `openid email profile \$\{GMAIL_SEND_SCOPE\}`/);
  assert.match(dialog, /Tiếp tục với Google/);
  assert.match(dialog, /Gmail đã kết nối — kiểm tra lại trước khi gửi/);
  assert.match(dialog, /MAX_RECIPIENTS = 6/);
  assert.match(dialog, /Còn \$\{quota\.batchesRemaining\}\/20 lượt gửi/);
  assert.match(dialog, /<details className="invitation-draft-details"/);
  assert.match(dialog, /access\.history\?\.length > 0/);
});

test("invitation controls expose focus, live status, errors, and target sizes", () => {
  assert.match(dialog, /keepFocusInside/);
  assert.match(dialog, /returnFocusRef\.current\?\.focus/);
  assert.match(dialog, /role="alert"/);
  assert.match(dialog, /role="status"/);
  assert.match(dialog, /aria-label="Tiến trình mở quyền gửi lời rủ"/);
  assert.match(styles, /\.invitation-sheet-footer button \{[^}]*min-height: 44px/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("admin separates permission inbox, delivery audit, and user audit", () => {
  assert.match(admin, /Yêu cầu quyền/);
  assert.match(admin, /Lịch sử gửi/);
  assert.match(admin, /status === "pending"/);
  assert.match(admin, /updatePermission\(permission, "approve"\)/);
  assert.match(admin, /action: "deny"/);
  assert.match(admin, /action: "revoke"/);
  assert.match(admin, /maxLength=\{300\}/);
  assert.match(admin, /item\.inviterEmail/);
  assert.doesNotMatch(users, /api\/invitations/);
  assert.doesNotMatch(users, /createInvitationDraft/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.permission-row \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
});
