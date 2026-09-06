import { AssistantLauncher, useAssistantNavigation } from "./v1/AssistantProvider";
import adminShellStyles from "../src/styles/admin-shell.module.css";
import Link from "next/link";
import { ADMIN_ROUTES } from "../lib/admin-routes.mjs";
import { useLocale } from "./LocaleProvider";

export default function AdminNav({
  active,
  tripSlug,
  pendingInvitationCount = 0,
  pendingTripRequestCount = 0,
}) {
  const assistant = useAssistantNavigation();
  const { t } = useLocale();
  return (
    <nav className={adminShellStyles["admin-nav"]} data-owner={assistant?.isOwner || undefined} style={{ "--admin-columns": assistant?.enabled ? (assistant.isOwner ? 6 : 5) : 4 }} aria-label={t("nav.adminArea")}>
      <Link
        href={ADMIN_ROUTES.trips}
        aria-current={active === "trips" ? "page" : undefined}
      >
        {t("nav.adminTrips")}
      </Link>
      <Link
        href={ADMIN_ROUTES.requests}
        aria-current={active === "requests" ? "page" : undefined}
      >
        {t("nav.adminRequests")}
        {pendingTripRequestCount > 0 && (
          <span
            className={adminShellStyles["admin-nav-badge"]}
            aria-label={`${pendingTripRequestCount} ${t("nav.adminRequests").toLowerCase()}`}
          >
            {pendingTripRequestCount}
          </span>
        )}
      </Link>
      <Link
        href={ADMIN_ROUTES.invitations}
        aria-current={active === "invitations" ? "page" : undefined}
      >
        {t("nav.adminInvitations")}
        {pendingInvitationCount > 0 && (
          <span
            className={adminShellStyles["admin-nav-badge"]}
            aria-label={`${pendingInvitationCount} ${t("nav.adminInvitations").toLowerCase()}`}
          >
            {pendingInvitationCount}
          </span>
        )}
      </Link>
      <Link
        href={ADMIN_ROUTES.users}
        aria-current={active === "users" ? "page" : undefined}
      >
        {t("nav.adminUsers")}
      </Link>
      <AssistantLauncher tripSlug={tripSlug} />
      {assistant?.isOwner && <Link href={ADMIN_ROUTES.assistant} aria-current={active === "assistant" ? "page" : undefined}>{t("nav.adminAssistant")}</Link>}
    </nav>
  );
}
