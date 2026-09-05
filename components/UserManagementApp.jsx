"use client";

import Link from "next/link";
import { useState } from "react";
import { signOut } from "next-auth/react";
import AdminNav from "./AdminNav";
import ConfirmDialog from "./ConfirmDialog";

const loginTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Tokyo",
});

function LoginTime({ value }) {
  return <time dateTime={value}><span>{loginTimeFormatter.format(new Date(value))}</span><small>JST</small></time>;
}

export default function UserManagementApp({ viewer, users, pendingInvitationCount = 0, pendingTripRequestCount = 0 }) {
  const [userRows, setUserRows] = useState(users);
  const [rolePrompt, setRolePrompt] = useState(null);
  const [busyEmail, setBusyEmail] = useState("");
  const [roleErrors, setRoleErrors] = useState({});

  const requestRoleChange = (user, role) => {
    if (role === user.role) return;
    setRoleErrors((current) => ({ ...current, [user.email]: "" }));
    setRolePrompt({ user, role });
  };

  const confirmRoleChange = async () => {
    if (!rolePrompt) return;
    const { user, role } = rolePrompt;
    setBusyEmail(user.email);
    setRoleErrors((current) => ({ ...current, [user.email]: "" }));
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.email)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Không cập nhật được phân quyền");
      setUserRows((current) => current.map((item) => item.email === user.email ? result : item));
      setRolePrompt(null);
    } catch (error) {
      setRoleErrors((current) => ({ ...current, [user.email]: `${error.message}. Hãy thử lại.` }));
    } finally {
      setBusyEmail("");
    }
  };

  return (
    <main className="admin-shell admin-users-shell">
      <header className="admin-header">
        <div><Link href="/" className="admin-back">Về lịch</Link><h1>Người dùng</h1><small className="admin-user">{viewer.email}</small></div>
        <button className="admin-ghost" onClick={() => signOut({ redirectTo: "/" })}>Đăng xuất</button>
      </header>
      <AdminNav active="users" pendingInvitationCount={pendingInvitationCount} pendingTripRequestCount={pendingTripRequestCount} />
      <section className="admin-users" aria-labelledby="admin-users-title">
        <div className="admin-users-head">
          <div><h2 id="admin-users-title">Hoạt động người dùng</h2><p>{userRows.length} tài khoản Google · quyền admin có hiệu lực từ request kế tiếp.</p></div>
        </div>
        {userRows.length ? (
          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead><tr><th scope="col">Tên</th><th scope="col">Email</th><th scope="col">Lần đầu đăng nhập</th><th scope="col">Hoạt động gần nhất</th><th scope="col">Quyền</th></tr></thead>
              <tbody>{userRows.map((loginUser) => (
                <tr key={loginUser.email}>
                  <td data-label="Tên"><strong>{loginUser.name}</strong></td>
                  <td data-label="Email">{loginUser.email}</td>
                  <td data-label="Lần đầu đăng nhập"><LoginTime value={loginUser.first_login} /></td>
                  <td data-label="Hoạt động gần nhất"><LoginTime value={loginUser.last_active_at} /></td>
                  <td data-label="Quyền" className="admin-user-role-cell">
                    {loginUser.role === "owner" ? (
                      <span className="user-role-badge is-owner">Owner <small>Cố định</small></span>
                    ) : viewer.isOwner ? (
                      <>
                        <label className="user-role-control">
                          <span className="sr-only">Quyền của {loginUser.name}</span>
                          <select value={loginUser.role} onChange={(event) => requestRoleChange(loginUser, event.target.value)} disabled={busyEmail === loginUser.email}>
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                        </label>
                        {roleErrors[loginUser.email] && <p className="user-role-error" role="alert">{roleErrors[loginUser.email]}</p>}
                      </>
                    ) : (
                      <span className={`user-role-badge is-${loginUser.role}`}>{loginUser.role === "admin" ? "Admin" : "Member"}</span>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="admin-users-empty">Chưa có hoạt động nào. Tài khoản sẽ xuất hiện sau lần đăng nhập Google tiếp theo.</p>}
      </section>
      {rolePrompt && (
        <ConfirmDialog
          title={rolePrompt.role === "admin" ? "Cấp quyền Admin?" : "Hạ xuống Member?"}
          description={rolePrompt.role === "admin"
            ? `${rolePrompt.user.name} sẽ được quản lý chuyến đi, lịch, lời mời và mọi nội dung đóng góp; người này không thể đổi role.`
            : `${rolePrompt.user.name} sẽ mất quyền truy cập khu quản trị từ request kế tiếp.`}
          preview={rolePrompt.user.email}
          confirmLabel={rolePrompt.role === "admin" ? "Cấp quyền Admin" : "Hạ xuống Member"}
          pendingLabel="Đang cập nhật…"
          pending={busyEmail === rolePrompt.user.email}
          error={roleErrors[rolePrompt.user.email] || ""}
          onCancel={() => setRolePrompt(null)}
          onConfirm={confirmRoleChange}
        />
      )}
    </main>
  );
}
