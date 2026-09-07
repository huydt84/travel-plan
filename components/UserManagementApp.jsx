"use client";
import adminShellStyles from "../src/styles/admin-shell.module.css";
import invitationManagementStyles from "../src/styles/invitation-management.module.css";

import Button from "./ui/Button";

import Link from "next/link";
import { useState } from "react";
import { signOut } from "next-auth/react";
import AdminNav from "./AdminNav";
import ConfirmDialog from "./ConfirmDialog";
import DisplayNameDialog from "./DisplayNameDialog";
import LanguageSwitcher from "./LanguageSwitcher";
import { useLocale } from "./LocaleProvider";
import { adminErrorMessage } from "../lib/i18n-admin.mjs";

const loginTimeOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Tokyo",
};

function LoginTime({ value }) {
  const { t, intlLocale } = useLocale();
  const loginTimeFormatter = new Intl.DateTimeFormat(
    intlLocale,
    loginTimeOptions,
  );
  return (
    <time dateTime={value}>
      <span>{loginTimeFormatter.format(new Date(value))}</span>
      <small>{t("adminExtra.message114")}</small>
    </time>
  );
}

export default function UserManagementApp({
  viewer,
  users,
  pendingInvitationCount = 0,
  pendingTripRequestCount = 0,
}) {
  const { t, locale } = useLocale();
  const [userRows, setUserRows] = useState(users);
  const [rolePrompt, setRolePrompt] = useState(null);
  const [displayNamePrompt, setDisplayNamePrompt] = useState(null);
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
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(user.email)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || t("adminExtra.message115"));
      setUserRows((current) =>
        current.map((item) => (item.email === user.email ? result : item)),
      );
      setRolePrompt(null);
    } catch (error) {
      setRoleErrors((current) => ({
        ...current,
        [user.email]: t("adminExtra.message025", {
          value0: adminErrorMessage(error, t, locale),
        }),
      }));
    } finally {
      setBusyEmail("");
    }
  };

  return (
    <main
      className={`${adminShellStyles["admin-shell"]} ${invitationManagementStyles["admin-users-shell"]}`}
    >
      <header className={adminShellStyles["admin-header"]}>
        <div>
          <Link href="/" className={adminShellStyles["admin-back"]}>
            {t("common.backToSchedule")}
          </Link>
          <h1>{t("nav.adminUsers")}</h1>
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
        active="users"
        pendingInvitationCount={pendingInvitationCount}
        pendingTripRequestCount={pendingTripRequestCount}
      />
      <section
        className={invitationManagementStyles["admin-users"]}
        aria-labelledby="admin-users-title"
      >
        <div className={invitationManagementStyles["admin-users-head"]}>
          <div>
            <h2 id="admin-users-title">{t("admin.userActivity")}</h2>
            <p>
              {userRows.length} {t("adminExtra.message116")}
            </p>
          </div>
        </div>
        {userRows.length ? (
          <div className={invitationManagementStyles["admin-users-table-wrap"]}>
            <table className={invitationManagementStyles["admin-users-table"]}>
              <thead>
                <tr>
                  <th scope="col">{t("profile.displayName")}</th>
                  <th scope="col">{t("adminExtra.message117")}</th>
                  <th scope="col">{t("adminExtra.message118")}</th>
                  <th scope="col">{t("adminExtra.message119")}</th>
                  <th scope="col">{t("adminExtra.message120")}</th>
                </tr>
              </thead>
              <tbody>
                {userRows.map((loginUser) => (
                  <tr key={loginUser.email}>
                    <td data-label={t("profile.displayName")}>
                      <strong>{loginUser.displayName || loginUser.name}</strong>
                      {viewer.isOwner && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="small"
                          onClick={() => setDisplayNamePrompt(loginUser)}
                        >
                          {t("profile.edit")}
                        </Button>
                      )}
                    </td>
                    <td data-label={t("adminExtra.message117")}>
                      {loginUser.email}
                    </td>
                    <td data-label={t("adminExtra.message118")}>
                      <LoginTime value={loginUser.first_login} />
                    </td>
                    <td data-label={t("adminExtra.message119")}>
                      <LoginTime value={loginUser.last_active_at} />
                    </td>
                    <td
                      data-label={t("adminExtra.message120")}
                      className={
                        invitationManagementStyles["admin-user-role-cell"]
                      }
                    >
                      {loginUser.role === "owner" ? (
                        <span
                          className={`${invitationManagementStyles["user-role-badge"]} is-owner`}
                        >
                          {t("adminExtra.message121")}{" "}
                          <small>{t("adminExtra.message122")}</small>
                        </span>
                      ) : viewer.isOwner ? (
                        <>
                          <label
                            className={
                              invitationManagementStyles["user-role-control"]
                            }
                          >
                            <span className="sr-only">
                              {t("adminExtra.message123")} {loginUser.displayName || loginUser.name}
                            </span>
                            <select
                              value={loginUser.role}
                              onChange={(event) =>
                                requestRoleChange(loginUser, event.target.value)
                              }
                              disabled={busyEmail === loginUser.email}
                            >
                              <option value="member">
                                {t("adminExtra.message124")}
                              </option>
                              <option value="admin">
                                {t("adminExtra.message125")}
                              </option>
                            </select>
                          </label>
                          {roleErrors[loginUser.email] && (
                            <p
                              className={
                                invitationManagementStyles["user-role-error"]
                              }
                              role="alert"
                            >
                              {roleErrors[loginUser.email]}
                            </p>
                          )}
                        </>
                      ) : (
                        <span
                          className={`${invitationManagementStyles["user-role-badge"]} is-${loginUser.role}`}
                        >
                          {loginUser.role === "admin"
                            ? t("adminExtra.message125")
                            : t("adminExtra.message124")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={invitationManagementStyles["admin-users-empty"]}>
            {t("adminExtra.message126")}
          </p>
        )}
      </section>
      {rolePrompt && (
        <ConfirmDialog
          title={
            rolePrompt.role === "admin"
              ? t("adminExtra.message127")
              : t("adminExtra.message128")
          }
          description={
            rolePrompt.role === "admin"
              ? t("adminExtra.message129", { value0: rolePrompt.user.displayName || rolePrompt.user.name })
              : t("adminExtra.message130", { value0: rolePrompt.user.displayName || rolePrompt.user.name })
          }
          preview={rolePrompt.user.email}
          confirmLabel={
            rolePrompt.role === "admin"
              ? t("adminExtra.message131")
              : t("adminExtra.message132")
          }
          pendingLabel={t("adminExtra.message133")}
          pending={busyEmail === rolePrompt.user.email}
          error={roleErrors[rolePrompt.user.email] || ""}
          onCancel={() => setRolePrompt(null)}
          onConfirm={confirmRoleChange}
        />
      )}
      {displayNamePrompt && (
        <DisplayNameDialog
          displayName={displayNamePrompt.displayName || displayNamePrompt.name}
          endpoint={`/api/admin/users/${encodeURIComponent(displayNamePrompt.email)}`}
          onCancel={() => setDisplayNamePrompt(null)}
          onSaved={(nextDisplayName) => {
            setUserRows((current) => current.map((item) => item.email === displayNamePrompt.email
              ? { ...item, name: nextDisplayName, displayName: nextDisplayName }
              : item));
            setDisplayNamePrompt(null);
          }}
        />
      )}
    </main>
  );
}
