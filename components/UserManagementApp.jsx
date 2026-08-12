"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import AdminNav from "./AdminNav";

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

export default function UserManagementApp({ viewer, users, pendingInvitationCount = 0 }) {
  return (
    <main className="admin-shell admin-users-shell">
      <header className="admin-header">
        <div><Link href="/" className="admin-back">Về lịch</Link><h1>Người dùng</h1><small className="admin-user">{viewer.email}</small></div>
        <button className="admin-ghost" onClick={() => signOut({ redirectTo: "/" })}>Đăng xuất</button>
      </header>
      <AdminNav active="users" pendingInvitationCount={pendingInvitationCount} />
      <section className="admin-users" aria-labelledby="admin-users-title">
        <div className="admin-users-head">
          <div><h2 id="admin-users-title">Lịch sử đăng nhập</h2><p>{users.length} tài khoản Google · chỉ giữ lần đầu và lần đăng nhập gần nhất.</p></div>
        </div>
        {users.length ? (
          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead><tr><th scope="col">Tên</th><th scope="col">Email</th><th scope="col">Lần đầu đăng nhập</th><th scope="col">Gần nhất</th></tr></thead>
              <tbody>{users.map((loginUser) => (
                <tr key={loginUser.email}>
                  <td data-label="Tên"><strong>{loginUser.name}</strong></td>
                  <td data-label="Email">{loginUser.email}</td>
                  <td data-label="Lần đầu đăng nhập"><LoginTime value={loginUser.first_login} /></td>
                  <td data-label="Gần nhất"><LoginTime value={loginUser.last_login} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="admin-users-empty">Chưa có dữ liệu. Tài khoản sẽ xuất hiện sau lần đăng nhập Google tiếp theo.</p>}
      </section>
    </main>
  );
}
