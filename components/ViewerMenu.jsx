"use client";
import navigationStyles from "../src/styles/navigation.module.css";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { ADMIN_ROUTES } from "../lib/admin-routes.mjs";
import { ActionIcon } from "./Icons";

const MENU_ID = "viewer-account-menu";

export default function ViewerMenu({ viewer }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const localDev = viewer.authMode === "local-dev";
  const label =
    localDev && viewer.isOwner ? "Local admin" : viewer.name || viewer.email;
  const initial = label?.trim().charAt(0).toLocaleUpperCase("vi") || "T";
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
        aria-label={`Mở menu tài khoản của ${label}`}
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
          aria-label="Tài khoản"
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
            Yêu cầu của tôi
          </Link>
          {viewer.isAdmin && (
            <Link
              className={manageClassName}
              href={ADMIN_ROUTES.trips}
              onClick={() => setOpen(false)}
            >
              Quản lý
            </Link>
          )}
          {!localDev && (
            <button
              className={navigationStyles["viewer-menu-item"]}
              type="button"
              onClick={() => signOut({ redirectTo: "/" })}
            >
              Đăng xuất
            </button>
          )}
        </div>
      )}
    </div>
  );
}
