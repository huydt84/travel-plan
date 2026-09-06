"use client";
import adminShellStyles from "../src/styles/admin-shell.module.css";
import invitationManagementStyles from "../src/styles/invitation-management.module.css";

import Button from "./ui/Button";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useMemo, useState } from "react";
import AdminNav from "./AdminNav";
import LanguageSwitcher from "./LanguageSwitcher";
import { useLocale } from "./LocaleProvider";
import { invitationErrorText } from "../lib/i18n-invitations.mjs";

const timeOptions = {
  dateStyle: "short",
  timeStyle: "short",
  hour12: false,
  timeZone: "Asia/Tokyo",
};

const formatTime = (value, locale = "vi-VN") =>
  value ? new Intl.DateTimeFormat(locale, timeOptions).format(new Date(value)) : "—";

export default function InvitationAdminApp({
  viewer,
  initialPermissions,
  initialHistory,
  activeView,
  pendingTripRequestCount = 0,
}) {
  const { t, intlLocale, locale } = useLocale();
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
        throw new Error(payload.error || "invitationsExtra.updatePermissionError");
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
          <Link href="/" className={adminShellStyles["admin-back"]}>{t("invitationsExtra.back")}
          </Link>
          <h1>{t("nav.adminInvitations")}</h1>
          <small className={adminShellStyles["admin-user"]}>
            {viewer.email}
          </small>
        </div>
        <LanguageSwitcher />
        <Button variant="ghost" onClick={() => signOut({ redirectTo: "/" })}>
          {t("common.logout")}
        </Button>
      </header>
      <AdminNav
        active="invitations"
        pendingInvitationCount={pendingCount}
        pendingTripRequestCount={pendingTripRequestCount}
      />
      <nav
        className={invitationManagementStyles["invitation-admin-tabs"]}
        aria-label={t("invitationsExtra.tabs")}
      >
        <Link
          href="/admin/invitations"
          aria-current={activeView === "requests" ? "page" : undefined}
        >{t("invitationsExtra.permissionRequests")} <span>{pendingCount}</span>
        </Link>
        <Link
          href="/admin/invitations?view=history"
          aria-current={activeView === "history" ? "page" : undefined}
        >{t("invitationsExtra.history")} <span>{initialHistory.length}</span>
        </Link>
      </nav>

      {activeView === "requests" ? (
        <section
          className={invitationManagementStyles["permission-board"]}
          aria-labelledby="permission-board-title"
        >
          <div className={invitationManagementStyles["permission-board-head"]}>
            <div>
              <h2 id="permission-board-title">{t("invitationsExtra.permissionTitle")}</h2>
              <p>{t("invitationsExtra.permissionHelp")}
              </p>
            </div>
            <strong>{t("invitationsExtra.pendingCount", { count: pendingCount })}</strong>
          </div>
          <div className={invitationManagementStyles["permission-controls"]}>
            <label>{t("invitationsExtra.searchUser")}
              <input
                type="search"
                value={query}
                placeholder={t("invitationsExtra.userPlaceholder")}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>{t("invitationsExtra.status")}
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">{t("invitationsExtra.all")}</option>
                <option value="pending">{t("invitationsExtra.pending")}</option>
                <option value="approved">{t("invitationsExtra.approved")}</option>
                <option value="denied">{t("invitationsExtra.denied")}</option>
                <option value="revoked">{t("invitationsExtra.revoked")}</option>
              </select>
            </label>
            <p aria-live="polite">
              {t("invitationsExtra.showing", { visible: visiblePermissions.length, total: permissions.length })}
            </p>
          </div>
          {error && (
            <p
              className={invitationManagementStyles["permission-global-error"]}
              role="alert"
            >
              {invitationErrorText(t, locale, error, "invitationsExtra.updatePermissionError")}
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
                    <small>{t("invitationsExtra.requestedFrom")}</small>
                    <strong>{permission.requestedTripTitle}</strong>
                  </div>
                  <div
                    className={invitationManagementStyles["permission-state"]}
                  >
                    <span>{t(`invitationsExtra.${permission.status}`)}</span>
                    <time>
                      {formatTime(
                        permission.reviewedAt || permission.requestedAt,
                        intlLocale,
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
                          ? t("invitationsExtra.approve")
                          : t("invitationsExtra.approveAgain")}
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
                      >{t("invitationsExtra.denied")}
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
                      >{t("invitationsExtra.revoked")}
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
                          ? t("invitationsExtra.denyReason")
                          : t("invitationsExtra.revokeReason")}
                        <textarea
                          maxLength={300}
                          rows={3}
                          value={decision.reason}
                          placeholder={t("invitationsExtra.optional")}
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
                        >{t("invitationsExtra.cancel")}
                        </Button>
                        <Button
                          variant="danger"
                          disabled={busyId === permission.id}
                        >
                          {busyId === permission.id
                            ? t("invitationsExtra.updating")
                            : decision.action === "deny"
                              ? t("invitationsExtra.denyRequest")
                              : t("invitationsExtra.revokePermission")}
                        </Button>
                      </div>
                    </form>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className={invitationManagementStyles["permission-empty"]}>{t("invitationsExtra.noRequests")}
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
              <h2 id="invitation-history-title">{t("invitationsExtra.history")}</h2>
              <p>{t("invitationsExtra.historyHelp")}</p>
            </div>
            <strong>{t("invitationsExtra.attemptCount", { count: initialHistory.length })}</strong>
          </div>
          <div
            className={
              invitationManagementStyles["invitation-history-controls"]
            }
          >
            <label>{t("invitationsExtra.searchHistory")}
              <input
                type="search"
                value={historyQuery}
                placeholder={t("invitationsExtra.historyPlaceholder")}
                onChange={(event) => setHistoryQuery(event.target.value)}
              />
            </label>
            <label>{t("invitationsExtra.status")}
              <select
                value={historyStatus}
                onChange={(event) => setHistoryStatus(event.target.value)}
              >
                <option value="all">{t("invitationsExtra.all")}</option>
                <option value="sent">{t("invitationsExtra.sent")}</option>
                <option value="failed">{t("invitationsExtra.failed")}</option>
              </select>
            </label>
            <p>
              {t("invitationsExtra.showing", { visible: visibleHistory.length, total: initialHistory.length })}
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
                    <th scope="col">{t("invitationsExtra.sender")}</th>
                    <th scope="col">{t("invitationsExtra.recipient")}</th>
                    <th scope="col">{t("invitationsExtra.trip")}</th>
                    <th scope="col">{t("invitationsExtra.status")}</th>
                    <th scope="col">{t("invitationsExtra.time")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleHistory.map((item) => (
                    <tr key={item.id}>
                      <td data-label={t("invitationsExtra.sender")}>
                        <strong>{item.inviterEmail}</strong>
                      </td>
                      <td data-label={t("invitationsExtra.recipient")}>{item.recipientEmail}</td>
                      <td data-label={t("invitationsExtra.trip")}>
                        <Link
                          href={`/?trip=${encodeURIComponent(item.tripSlug)}`}
                        >
                          {item.tripTitle}
                        </Link>
                      </td>
                      <td data-label={t("invitationsExtra.status")}>
                        <span
                          className={`${invitationManagementStyles["invitation-history-status"]} is-${item.status}`}
                        >
                          {item.status === "sent" ? t("invitationsExtra.sent") : t("invitationsExtra.failed")}
                        </span>
                        {item.errorCode && (
                          <small>
                            {t({ INVITATION_AUTH_ERROR: "invitationsExtra.gmailReconnect", INVITATION_DELIVERY_ERROR: "invitationsExtra.gmailRejected", GMAIL_API_ERROR: "invitationsExtra.gmailError" }[item.errorCode] || "invitationsExtra.deliveryFailed")}
                          </small>
                        )}
                      </td>
                      <td data-label={t("invitationsExtra.time")}>
                        <time>
                          {formatTime(item.sentAt || item.attemptedAt, intlLocale)}
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
            >{t("invitationsExtra.noHistory")}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
