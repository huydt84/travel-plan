"use client";
import navigationStyles from "../src/styles/navigation.module.css";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { ADMIN_ROUTES } from "../lib/admin-routes.mjs";
import { ActionIcon } from "./Icons";
import { useLocale } from "./LocaleProvider";
import DisplayNameDialog from "./DisplayNameDialog";

const MENU_ID = "viewer-account-menu";

export default function ViewerMenu({ viewer }) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(viewer.displayName || viewer.name || viewer.email);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const localDev = viewer.authMode === "local-dev";
  const label = localDev && viewer.isOwner ? "Local admin" : displayName;
  const initial = label?.trim().charAt(0).toLocaleUpperCase(locale) || "T";
  const manageClassName = localDev
    ? navigationStyles["viewer-menu-item"]
    : `${navigationStyles["viewer-menu-item"]} ${navigationStyles["mobile-manage-link"]}`;

  useEffect(() => {
    if (!open) return undefined;

    const closeFromOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeFromEscape = (event) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [open]);

  return (
    <div className={navigationStyles["viewer-menu"]} ref={rootRef}>
      <button
        ref={triggerRef}
        className={`${navigationStyles["admin-link"]} ${navigationStyles["user-link"]} ${navigationStyles["viewer-menu-trigger"]}`}
        type="button"
        aria-expanded={open}
        aria-controls={MENU_ID}
        aria-label={t("nav.openAccount", { name: label })}
        onClick={() => setOpen((current) => !current)}
      >
        {viewer.image ? (
          <Image
            src={viewer.image}
            alt=""
            width={24}
            height={24}
            unoptimized
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className={navigationStyles["user-avatar"]} aria-hidden="true">
            {initial}
          </span>
        )}
        <span className={navigationStyles["viewer-name"]}>{label}</span>
        <ActionIcon name="down" />
      </button>

      {open && (
        <div
          className={navigationStyles["viewer-menu-panel"]}
          id={MENU_ID}
          role="group"
          aria-label={t("nav.account")}
        >
          <div className={navigationStyles["viewer-menu-identity"]}>
            <strong>{label}</strong>
            {!localDev && viewer.email && viewer.email !== label && (
              <span>{viewer.email}</span>
            )}
          </div>
          <Link
            className={navigationStyles["viewer-menu-item"]}
            href="/requests"
            onClick={() => setOpen(false)}
          >
            {t("nav.myRequests")}
          </Link>
          <button
            className={navigationStyles["viewer-menu-item"]}
            type="button"
            onClick={() => {
              setOpen(false);
              setEditNameOpen(true);
            }}
          >
            {t("profile.editTitle")}
          </button>
          {viewer.isAdmin && (
            <Link
              className={manageClassName}
              href={ADMIN_ROUTES.trips}
              onClick={() => setOpen(false)}
            >
              {t("common.manage")}
            </Link>
          )}
          {!localDev && (
            <button
              className={navigationStyles["viewer-menu-item"]}
              type="button"
              onClick={() => signOut({ redirectTo: "/" })}
            >
              {t("common.logout")}
            </button>
          )}
        </div>
      )}
      {editNameOpen && (
        <DisplayNameDialog
          displayName={displayName}
          endpoint="/api/profile"
          onCancel={() => setEditNameOpen(false)}
          onSaved={(nextDisplayName) => {
            setDisplayName(nextDisplayName);
            setEditNameOpen(false);
          }}
        />
      )}
    </div>
  );
}
