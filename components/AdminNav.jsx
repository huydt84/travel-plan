import { AssistantLauncher, useAssistantNavigation } from "./v1/AssistantProvider";
import adminShellStyles from "../src/styles/admin-shell.module.css";
import Link from "next/link";
import { ADMIN_ROUTES } from "../lib/admin-routes.mjs";

export default function AdminNav({
  active,
  tripSlug,
  pendingInvitationCount = 0,
  pendingTripRequestCount = 0,
}) {
  const assistant = useAssistantNavigation();
  return (
    <nav className={adminShellStyles["admin-nav"]} data-owner={assistant?.isOwner || undefined} style={{ "--admin-columns": assistant?.enabled ? (assistant.isOwner ? 6 : 5) : 4 }} aria-label="Khu vực quản lý">
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
      {assistant?.isOwner && <Link href={ADMIN_ROUTES.assistant} aria-current={active === "assistant" ? "page" : undefined}>Quản lý trợ lý</Link>}
    </nav>
  );
}
