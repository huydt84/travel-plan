import { ADMIN_ROUTES } from "../lib/admin-routes.mjs";

export default function AdminNav({ active }) {
  return (
    <nav className="admin-nav" aria-label="Khu vực quản lý">
      <a href={ADMIN_ROUTES.trips} aria-current={active === "trips" ? "page" : undefined}>Lịch trình</a>
      <a href={ADMIN_ROUTES.users} aria-current={active === "users" ? "page" : undefined}>Người dùng</a>
    </nav>
  );
}
