"use client";
import adminShellStyles from "../src/styles/admin-shell.module.css";
import invitationManagementStyles from "../src/styles/invitation-management.module.css";

import Button from "./ui/Button";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useMemo, useState } from "react";
import AdminNav from "./AdminNav";

const timeFormatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  hour12: false,
  timeZone: "Asia/Tokyo",
});
const statusLabels = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  denied: "Từ chối",
  revoked: "Thu hồi",
};
const deliveryErrorLabels = {
  INVITATION_AUTH_ERROR: "Gmail cần kết nối lại",
  INVITATION_DELIVERY_ERROR: "Gmail từ chối gửi",
  GMAIL_API_ERROR: "Gmail trả về lỗi",
};

const formatTime = (value) =>
  value ? timeFormatter.format(new Date(value)) : "—";

export default function InvitationAdminApp({
  viewer,
  initialPermissions,
  initialHistory,
  activeView,
  pendingTripRequestCount = 0,
}) {
  const [permissions, setPermissions] = useState(initialPermissions);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("pending");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [decision, setDecision] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const pendingCount = permissions.filter(
    (item) => item.status === "pending",
  ).length;
  const normalizedQuery = query.trim().toLowerCase();
  const visiblePermissions = permissions.filter(
    (item) =>
      (status === "all" || item.status === status) &&
      (!normalizedQuery ||
        item.userEmail.toLowerCase().includes(normalizedQuery) ||
        item.userName.toLowerCase().includes(normalizedQuery)),
  );
  const visibleHistory = useMemo(() => {
    const needle = historyQuery.trim().toLowerCase();
    return initialHistory.filter(
      (item) =>
        (historyStatus === "all" || item.status === historyStatus) &&
        (!needle ||
          item.inviterEmail.toLowerCase().includes(needle) ||
          item.recipientEmail.toLowerCase().includes(needle) ||
          item.tripTitle.toLowerCase().includes(needle)),
    );
  }, [initialHistory, historyQuery, historyStatus]);

  const updatePermission = async (permission, action, reason = "") => {
    setBusyId(permission.id);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/invitation-permissions/${permission.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, reason }),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Không thể cập nhật quyền");
      setPermissions((current) =>
        current.map((item) =>
          item.id === payload.id
            ? { ...item, ...payload, userName: item.userName }
            : item,
        ),
      );
      setDecision(null);
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main
      className={`${adminShellStyles["admin-shell"]} ${invitationManagementStyles["admin-invitations-shell"]}`}
    >
      <header className={adminShellStyles["admin-header"]}>
        <div>
          <Link href="/" className={adminShellStyles["admin-back"]}>
            Về lịch
          </Link>
          <h1>Lời rủ</h1>
          <small className={adminShellStyles["admin-user"]}>
            {viewer.email}
          </small>
        </div>
        <Button variant="ghost" onClick={() => signOut({ redirectTo: "/" })}>
          Đăng xuất
        </Button>
      </header>
      <AdminNav
        active="invitations"
        pendingInvitationCount={pendingCount}
        pendingTripRequestCount={pendingTripRequestCount}
      />
      <nav
        className={invitationManagementStyles["invitation-admin-tabs"]}
        aria-label="Nội dung lời rủ"
      >
        <Link
          href="/admin/invitations"
          aria-current={activeView === "requests" ? "page" : undefined}
        >
          Yêu cầu quyền <span>{pendingCount}</span>
        </Link>
        <Link
          href="/admin/invitations?view=history"
          aria-current={activeView === "history" ? "page" : undefined}
        >
          Lịch sử gửi <span>{initialHistory.length}</span>
        </Link>
      </nav>

      {activeView === "requests" ? (
        <section
          className={invitationManagementStyles["permission-board"]}
          aria-labelledby="permission-board-title"
        >
          <div className={invitationManagementStyles["permission-board-head"]}>
            <div>
              <h2 id="permission-board-title">Quyền gửi lời rủ</h2>
              <p>
                Duyệt theo tài khoản · quyền có hiệu lực với mọi chuyến cho đến
                khi bị thu hồi.
              </p>
            </div>
            <strong>{pendingCount} chờ duyệt</strong>
          </div>
          <div className={invitationManagementStyles["permission-controls"]}>
            <label>
              Tìm người dùng
              <input
                type="search"
                value={query}
                placeholder="Tên hoặc email…"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              Trạng thái
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">Tất cả</option>
                <option value="pending">Chờ duyệt</option>
                <option value="approved">Đã duyệt</option>
                <option value="denied">Từ chối</option>
                <option value="revoked">Thu hồi</option>
              </select>
            </label>
            <p aria-live="polite">
              Hiện {visiblePermissions.length}/{permissions.length}
            </p>
          </div>
          {error && (
            <p
              className={invitationManagementStyles["permission-global-error"]}
              role="alert"
            >
              {error}
            </p>
          )}
          {visiblePermissions.length ? (
            <div className={invitationManagementStyles["permission-list"]}>
              {visiblePermissions.map((permission) => (
                <article
                  className={`${invitationManagementStyles["permission-row"]} is-${permission.status}`}
                  key={permission.id}
                >
                  <div
                    className={invitationManagementStyles["permission-person"]}
                  >
                    <strong>{permission.userName}</strong>
                    <span>{permission.userEmail}</span>
                  </div>
                  <div
                    className={invitationManagementStyles["permission-trip"]}
                  >
                    <small>Yêu cầu từ</small>
                    <strong>{permission.requestedTripTitle}</strong>
                  </div>
                  <div
                    className={invitationManagementStyles["permission-state"]}
                  >
                    <span>{statusLabels[permission.status]}</span>
                    <time>
                      {formatTime(
                        permission.reviewedAt || permission.requestedAt,
                      )}
                    </time>
                  </div>
                  <div
                    className={invitationManagementStyles["permission-actions"]}
                  >
                    {permission.status !== "approved" && (
                      <Button
                        variant="primary"
                        type="button"
                        disabled={busyId === permission.id}
                        onClick={() => updatePermission(permission, "approve")}
                      >
                        {permission.status === "pending"
                          ? "Duyệt"
                          : "Duyệt lại"}
                      </Button>
                    )}
                    {permission.status === "pending" && (
                      <Button
                        variant="danger"
                        type="button"
                        onClick={() =>
                          setDecision({
                            permission,
                            action: "deny",
                            reason: "",
                          })
                        }
                      >
                        Từ chối
                      </Button>
                    )}
                    {permission.status === "approved" && (
                      <Button
                        variant="danger"
                        type="button"
                        onClick={() =>
                          setDecision({
                            permission,
                            action: "revoke",
                            reason: "",
                          })
                        }
                      >
                        Thu hồi
                      </Button>
                    )}
                  </div>
                  {permission.decisionReason &&
                    permission.status !== "approved" && (
                      <p
                        className={
                          invitationManagementStyles["permission-reason"]
                        }
                      >
                        {permission.decisionReason}
                      </p>
                    )}
                  {decision?.permission.id === permission.id && (
                    <form
                      className={
                        invitationManagementStyles["permission-decision"]
                      }
                      onSubmit={(event) => {
                        event.preventDefault();
                        updatePermission(
                          permission,
                          decision.action,
                          decision.reason,
                        );
                      }}
                    >
                      <label>
                        {decision.action === "deny"
                          ? "Lý do từ chối"
                          : "Lý do thu hồi"}
                        <textarea
                          maxLength={300}
                          rows={3}
                          value={decision.reason}
                          placeholder="Không bắt buộc"
                          onChange={(event) =>
                            setDecision((current) => ({
                              ...current,
                              reason: event.target.value,
                            }))
                          }
                        />
                        <span>{decision.reason.length}/300</span>
                      </label>
                      <div>
                        <Button
                          variant="ghost"
                          type="button"
                          onClick={() => setDecision(null)}
                        >
                          Huỷ
                        </Button>
                        <Button
                          variant="danger"
                          disabled={busyId === permission.id}
                        >
                          {busyId === permission.id
                            ? "Đang cập nhật…"
                            : decision.action === "deny"
                              ? "Từ chối yêu cầu"
                              : "Thu hồi quyền"}
                        </Button>
                      </div>
                    </form>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className={invitationManagementStyles["permission-empty"]}>
              Không có yêu cầu khớp bộ lọc này.
            </p>
          )}
        </section>
      ) : (
        <section
          className={invitationManagementStyles["admin-invitation-history"]}
          aria-labelledby="invitation-history-title"
        >
          <div
            className={invitationManagementStyles["invitation-history-head"]}
          >
            <div>
              <h2 id="invitation-history-title">Lịch sử gửi</h2>
              <p>Tối đa 200 lượt gần nhất · mỗi người nhận là một bản ghi.</p>
            </div>
            <strong>{initialHistory.length} lượt</strong>
          </div>
          <div
            className={
              invitationManagementStyles["invitation-history-controls"]
            }
          >
            <label>
              Tìm người gửi, nhận hoặc chuyến đi
              <input
                type="search"
                value={historyQuery}
                placeholder="Email hoặc chuyến đi…"
                onChange={(event) => setHistoryQuery(event.target.value)}
              />
            </label>
            <label>
              Trạng thái
              <select
                value={historyStatus}
                onChange={(event) => setHistoryStatus(event.target.value)}
              >
                <option value="all">Tất cả</option>
                <option value="sent">Đã gửi</option>
                <option value="failed">Gửi lỗi</option>
              </select>
            </label>
            <p>
              Hiện {visibleHistory.length}/{initialHistory.length}
            </p>
          </div>
          {visibleHistory.length ? (
            <div
              className={
                invitationManagementStyles["invitation-history-table-wrap"]
              }
            >
              <table
                className={
                  invitationManagementStyles["invitation-history-table"]
                }
              >
                <thead>
                  <tr>
                    <th scope="col">Người gửi</th>
                    <th scope="col">Người nhận</th>
                    <th scope="col">Chuyến đi</th>
                    <th scope="col">Trạng thái</th>
                    <th scope="col">Thời gian</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleHistory.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Người gửi">
                        <strong>{item.inviterEmail}</strong>
                      </td>
                      <td data-label="Người nhận">{item.recipientEmail}</td>
                      <td data-label="Chuyến đi">
                        <Link
                          href={`/?trip=${encodeURIComponent(item.tripSlug)}`}
                        >
                          {item.tripTitle}
                        </Link>
                      </td>
                      <td data-label="Trạng thái">
                        <span
                          className={`${invitationManagementStyles["invitation-history-status"]} is-${item.status}`}
                        >
                          {item.status === "sent" ? "Đã gửi" : "Gửi lỗi"}
                        </span>
                        {item.errorCode && (
                          <small>
                            {deliveryErrorLabels[item.errorCode] ||
                              "Không gửi được"}
                          </small>
                        )}
                      </td>
                      <td data-label="Thời gian">
                        <time>
                          {formatTime(item.sentAt || item.attemptedAt)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p
              className={invitationManagementStyles["invitation-history-empty"]}
            >
              Không có bản ghi khớp bộ lọc.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
