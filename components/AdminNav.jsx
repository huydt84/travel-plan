import { AssistantLauncher } from "./v1/AssistantProvider";
import adminShellStyles from "../src/styles/admin-shell.module.css";
import Link from "next/link";
import { ADMIN_ROUTES } from "../lib/admin-routes.mjs";

export default function AdminNav({
  active,
  tripSlug,
  pendingInvitationCount = 0,
  pendingTripRequestCount = 0,
}) {
  return (
    <nav className={adminShellStyles["admin-nav"]} aria-label="Khu vực quản lý">
      <Link
        href={ADMIN_ROUTES.trips}
        aria-current={active === "trips" ? "page" : undefined}
      >
        Lịch trình
      </Link>
      <Link
        href={ADMIN_ROUTES.requests}
        aria-current={active === "requests" ? "page" : undefined}
      >
        Yêu cầu
        {pendingTripRequestCount > 0 && (
          <span
            className={adminShellStyles["admin-nav-badge"]}
            aria-label={`${pendingTripRequestCount} yêu cầu chuyến đi đang chờ`}
          >
            {pendingTripRequestCount}
          </span>
        )}
      </Link>
      <Link
        href={ADMIN_ROUTES.invitations}
        aria-current={active === "invitations" ? "page" : undefined}
      >
        Lời rủ
        {pendingInvitationCount > 0 && (
          <span
            className={adminShellStyles["admin-nav-badge"]}
            aria-label={`${pendingInvitationCount} yêu cầu chờ duyệt`}
          >
            {pendingInvitationCount}
          </span>
        )}
      </Link>
      <Link
        href={ADMIN_ROUTES.users}
        aria-current={active === "users" ? "page" : undefined}
      >
        Người dùng
      </Link>
      <AssistantLauncher tripSlug={tripSlug} />
    </nav>
  );
}
