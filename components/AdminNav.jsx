import Link from "next/link";
import { ADMIN_ROUTES } from "../lib/admin-routes.mjs";

export default function AdminNav({ active, pendingInvitationCount = 0 }) {
  return (
    <nav className="admin-nav" aria-label="Khu vực quản lý">
      <Link href={ADMIN_ROUTES.trips} aria-current={active === "trips" ? "page" : undefined}>Lịch trình</Link>
      <Link href={ADMIN_ROUTES.invitations} aria-current={active === "invitations" ? "page" : undefined}>Lời rủ{pendingInvitationCount > 0 && <span className="admin-nav-badge" aria-label={`${pendingInvitationCount} yêu cầu chờ duyệt`}>{pendingInvitationCount}</span>}</Link>
      <Link href={ADMIN_ROUTES.users} aria-current={active === "users" ? "page" : undefined}>Người dùng</Link>
    </nav>
  );
}
