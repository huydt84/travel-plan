"use client";
import navigationStyles from "../src/styles/navigation.module.css";

import Footer from "./ui/Footer";
import styles from "./NotificationCenter.module.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionIcon } from "./Icons";
import Dialog, { DialogTitle } from "./ui/Dialog";
import { useLocale } from "./LocaleProvider";

const PANEL_ID = "viewer-notification-panel";
const POLL_INTERVAL = 45_000;
const NOTIFICATION_NAVIGATION_EVENT = "travel-plan:notification-navigation";

const relativeTime = (value, locale) => {
  const milliseconds = new Date(value).getTime() - Date.now();
  const absolute = Math.abs(milliseconds);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (absolute < 60_000) return locale === "en-US" ? "just now" : locale === "ja-JP" ? "たった今" : "vừa xong";
  if (absolute < 3_600_000)
    return formatter.format(Math.round(milliseconds / 60_000), "minute");
  if (absolute < 86_400_000)
    return formatter.format(Math.round(milliseconds / 3_600_000), "hour");
  if (absolute < 604_800_000)
    return formatter.format(Math.round(milliseconds / 86_400_000), "day");
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
};

const notificationCopy = (notification, t) => {
  if (notification.type === "assistant_handoff_created") {
    return {
      title: t("notifications.handoffCreated", { actor: notification.actor.name }),
      detail: notification.handoff.message,
    };
  }
  if (notification.type === "trip_request_fulfilled") {
    return {
      title: t("notifications.tripReady"),
      detail: t("notifications.tripLinked", { actor: notification.actor.name, trip: notification.trip.title }),
    };
  }
  if (notification.type === "contribution_visibility_changed") {
    return {
      title: notification.contribution.hidden
        ? t("notifications.contentHidden")
        : t("notifications.contentShown"),
      detail: t("notifications.visibilityChanged", { actor: notification.actor.name }),
    };
  }
  if (notification.type === "contribution_status_changed") {
    return {
      title: t("notifications.contributionStatus", { status: t({
        open: "notifications.reopened",
        accepted: "notifications.accepted",
        resolved: "notifications.resolved",
        rejected: "notifications.rejected",
      }[notification.contribution.status] || "notifications.updated") }),
      detail: t("notifications.statusChanged", { actor: notification.actor.name }),
    };
  }
  const action =
    notification.contribution.kind === "comment"
      ? t("notifications.commented")
      : t("notifications.suggested");
  return {
    title: `${notification.actor.name} ${action}`,
    detail: notification.contribution.body,
  };
};

export default function NotificationCenter() {
  const router = useRouter();
  const { t, intlLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState("");
  const [panelPosition, setPanelPosition] = useState({ top: 0, right: 0 });
  const triggerRef = useRef(null);
  const restoreFocusRef = useRef(true);
  const headingRef = useRef(null);

  const loadNotifications = useCallback(
    async ({ cursor = null, append = false, quiet = false } = {}) => {
      if (!quiet) append ? setLoadingMore(true) : setLoading(true);
      try {
        const query = new URLSearchParams({ limit: "30" });
        if (cursor) query.set("cursor", cursor);
        const response = await fetch(`/api/notifications?${query}`, {
          cache: "no-store",
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(result.error || t("notifications.loadError"));
        setNotifications((current) =>
          append
            ? [
                ...current,
                ...result.notifications.filter(
                  (item) =>
                    !current.some((existing) => existing.id === item.id),
                ),
              ]
            : result.notifications,
        );
        setUnreadCount(result.unreadCount);
        setNextCursor(result.nextCursor);
        setError("");
      } catch (loadError) {
        if (!quiet) setError(loadError.message);
      } finally {
        if (!quiet) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [t],
  );

  useEffect(() => {
    const initialLoad = window.setTimeout(() => loadNotifications(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadNotifications]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible")
        loadNotifications({ quiet: true });
    };
    const timer = window.setInterval(refresh, POLL_INTERVAL);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [loadNotifications]);

  const syncPanelPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPanelPosition({
      top: Math.round(rect.bottom + 7),
      right: Math.max(10, Math.round(window.innerWidth - rect.right)),
    });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    syncPanelPosition();
    const handleResize = () => syncPanelPosition();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [open, syncPanelPosition]);

  const closePanel = () => setOpen(false);

  const openNotification = (notification) => {
    restoreFocusRef.current = false;
    if (!notification.readAt) {
      const readAt = new Date().toISOString();
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, readAt } : item,
        ),
      );
      setUnreadCount((current) => Math.max(0, current - 1));
      fetch(`/api/notifications/${notification.id}`, { method: "PATCH" }).catch(
        () => {},
      );
    }
    setOpen(false);
    router.push(notification.targetUrl, { scroll: false });
    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent(NOTIFICATION_NAVIGATION_EVENT, {
          detail: { targetUrl: notification.targetUrl },
        }),
      );
    });
  };

  const markAllRead = async () => {
    const previous = notifications;
    const previousCount = unreadCount;
    const readAt = new Date().toISOString();
    setMarkingAll(true);
    setNotifications((current) =>
      current.map((item) => (item.readAt ? item : { ...item, readAt })),
    );
    setUnreadCount(0);
    try {
      const response = await fetch("/api/notifications/read-all", {
        method: "POST",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || t("notifications.markError"));
      setError("");
    } catch (markError) {
      setNotifications(previous);
      setUnreadCount(previousCount);
      setError(t("trackerExtra.retry", { error: markError.message }));
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadLabel = useMemo(
    () =>
      unreadCount === 1
      ? t("notifications.unreadOne")
        : t("notifications.unreadMany", { count: unreadCount }),
    [t, unreadCount],
  );

  return (
    <div className={styles["notification-center"]}>
      <button
        className={`${navigationStyles["admin-link"]} ${styles["notification-trigger"]}`}
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        aria-label={
          unreadCount ? t("notifications.openWithCount", { label: unreadLabel }) : t("notifications.open")
        }
        onClick={() => {
          restoreFocusRef.current = true;
          setOpen((current) => !current);
        }}
      >
        <ActionIcon name="bell" />
        {unreadCount > 0 && (
          <span className={styles["notification-badge"]} aria-hidden="true">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <Dialog
          onClose={closePanel}
          initialFocusRef={headingRef}
          restoreFocusRef={restoreFocusRef}
          overlayClassName={`${styles["notification-layer"]} ${styles["notification-backdrop"]}`}
        >
          <section
            className={styles["notification-panel"]}
            id={PANEL_ID}
            style={{
              "--notification-panel-top": `${panelPosition.top}px`,
              "--notification-panel-right": `${panelPosition.right}px`,
            }}
          >
            <header className={styles["notification-panel-head"]}>
              <div>
                <DialogTitle asChild>
                  <h2 tabIndex="-1" ref={headingRef}>
                    {t("notifications.title")}
                  </h2>
                </DialogTitle>
                <p>
                  {unreadCount
                    ? unreadLabel
                    : t("notifications.allCaughtUp")}
                </p>
              </div>
              <button type="button" aria-label={t("common.close")} onClick={closePanel}>
                <ActionIcon name="close" />
              </button>
            </header>

            <div className={styles["notification-panel-tools"]}>
              <span>{t("notifications.forYou")}</span>
              <button
                type="button"
                disabled={!unreadCount || markingAll}
                onClick={markAllRead}
              >
                {markingAll ? t("notifications.marking") : t("notifications.markAllRead")}
              </button>
            </div>

            <div
              className={styles["notification-panel-body"]}
              aria-live="polite"
            >
              {loading && !notifications.length && <NotificationSkeleton />}
              {error && !notifications.length && (
                <div
                  className={`${styles["notification-state"]} is-error`}
                  role="alert"
                >
                  <strong>{t("notifications.feedUnavailable")}</strong>
                  <p>{error}</p>
                  <button type="button" onClick={() => loadNotifications()}>
                    {t("common.retry")}
                  </button>
                </div>
              )}
              {!loading && !error && !notifications.length && (
                <div className={`${styles["notification-state"]} is-empty`}>
                  <span
                    className={styles["notification-empty-node"]}
                    aria-hidden="true"
                  />
                  <strong>{t("notifications.emptyFeed")}</strong>
                  <p>{t("notifications.emptyDescription")}</p>
                </div>
              )}
              {notifications.length > 0 && (
                <ul className={styles["notification-list"]}>
                  {notifications.map((notification) => {
                    const copy = notificationCopy(notification, t);
                    const target = notification.handoff
                      ? notification.handoff.title
                      : notification.request
                      ? notification.request.places.join(" · ")
                      : notification.contribution.activityTitle ||
                        t("notifications.wholeTrip");
                    const area = notification.handoff
                      ? t("notifications.handoffArea")
                      : notification.trip.title;
                    return (
                      <li
                        className={
                          notification.readAt ? "is-read" : "is-unread"
                        }
                        key={notification.id}
                      >
                        <button
                          type="button"
                          onClick={() => openNotification(notification)}
                        >
                          <span
                            className={styles["notification-route-node"]}
                            aria-hidden="true"
                          />
                          <span className={styles["notification-item-copy"]}>
                            <span className={styles["notification-item-meta"]}>
                              <strong>
                                {notification.readAt ? t("notifications.read") : t("notifications.unread")}
                              </strong>
                              <time dateTime={notification.createdAt}>
                                {relativeTime(notification.createdAt, intlLocale)}
                              </time>
                            </span>
                            <b>{copy.title}</b>
                            <span
                              className={styles["notification-item-detail"]}
                            >
                              {copy.detail}
                            </span>
                            <small>
                              {area} · {target}
                            </small>
                          </span>
                          <ActionIcon name="right" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {error && notifications.length > 0 && (
                <p className={styles["notification-inline-error"]} role="alert">
                  {error}
                </p>
              )}
            </div>

            {nextCursor && (
              <Footer className={styles["notification-panel-footer"]}>
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() =>
                    loadNotifications({ cursor: nextCursor, append: true })
                  }
                >
                  {loadingMore ? t("common.loading") : t("notifications.more")}
                </button>
              </Footer>
            )}
          </section>
        </Dialog>
      )}
    </div>
  );
}

function NotificationSkeleton() {
  const { t } = useLocale();
  return (
    <div
      className={styles["notification-skeleton"]}
      aria-label={t("notifications.loading")}
    >
      {[0, 1, 2].map((item) => (
        <span key={item}>
          <i />
          <b />
          <small />
        </span>
      ))}
    </div>
  );
}
