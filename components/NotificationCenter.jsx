"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionIcon } from "./Icons";

const PANEL_ID = "viewer-notification-panel";
const POLL_INTERVAL = 45_000;
const NOTIFICATION_NAVIGATION_EVENT = "travel-plan:notification-navigation";

const statusLabels = {
  accepted: "Đã nhận",
  resolved: "Đã xử lý",
  rejected: "Từ chối",
  open: "Mở lại",
};

const relativeTime = (value) => {
  const milliseconds = new Date(value).getTime() - Date.now();
  const absolute = Math.abs(milliseconds);
  const formatter = new Intl.RelativeTimeFormat("vi-VN", { numeric: "auto" });
  if (absolute < 60_000) return "vừa xong";
  if (absolute < 3_600_000) return formatter.format(Math.round(milliseconds / 60_000), "minute");
  if (absolute < 86_400_000) return formatter.format(Math.round(milliseconds / 3_600_000), "hour");
  if (absolute < 604_800_000) return formatter.format(Math.round(milliseconds / 86_400_000), "day");
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
};

const notificationCopy = (notification) => {
  if (notification.type === "contribution_status_changed") {
    return {
      title: `Góp ý của bạn: ${statusLabels[notification.contribution.status] || "Đã cập nhật"}`,
      detail: `${notification.actor.name} đã đổi trạng thái góp ý của bạn.`,
    };
  }
  const action = notification.contribution.kind === "comment" ? "đã bình luận" : "đã gửi một đề xuất";
  return {
    title: `${notification.actor.name} ${action}`,
    detail: notification.contribution.body,
  };
};

export default function NotificationCenter() {
  const router = useRouter();
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
  const panelRef = useRef(null);
  const headingRef = useRef(null);

  const loadNotifications = useCallback(async ({ cursor = null, append = false, quiet = false } = {}) => {
    if (!quiet) append ? setLoadingMore(true) : setLoading(true);
    try {
      const query = new URLSearchParams({ limit: "30" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/notifications?${query}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Không tải được thông báo");
      setNotifications((current) => append
        ? [...current, ...result.notifications.filter((item) => !current.some((existing) => existing.id === item.id))]
        : result.notifications);
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
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => loadNotifications(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadNotifications]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") loadNotifications({ quiet: true });
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
    headingRef.current?.focus();
    const handleResize = () => syncPanelPosition();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll("button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("resize", handleResize);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, syncPanelPosition]);

  const closePanel = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const openNotification = (notification) => {
    if (!notification.readAt) {
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt } : item));
      setUnreadCount((current) => Math.max(0, current - 1));
      fetch(`/api/notifications/${notification.id}`, { method: "PATCH" }).catch(() => {});
    }
    setOpen(false);
    router.push(notification.targetUrl, { scroll: false });
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent(NOTIFICATION_NAVIGATION_EVENT, {
        detail: { targetUrl: notification.targetUrl },
      }));
    });
  };

  const markAllRead = async () => {
    const previous = notifications;
    const previousCount = unreadCount;
    const readAt = new Date().toISOString();
    setMarkingAll(true);
    setNotifications((current) => current.map((item) => item.readAt ? item : { ...item, readAt }));
    setUnreadCount(0);
    try {
      const response = await fetch("/api/notifications/read-all", { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Không đánh dấu được thông báo");
      setError("");
    } catch (markError) {
      setNotifications(previous);
      setUnreadCount(previousCount);
      setError(`${markError.message}. Hãy thử lại.`);
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadLabel = useMemo(() => unreadCount === 1
    ? "1 thông báo chưa đọc"
    : `${unreadCount} thông báo chưa đọc`, [unreadCount]);

  return (
    <div className="notification-center">
      <button
        className="admin-link notification-trigger"
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        aria-label={unreadCount ? `Mở thông báo, ${unreadLabel}` : "Mở thông báo"}
        onClick={() => setOpen((current) => !current)}
      >
        <ActionIcon name="bell" />
        {unreadCount > 0 && <span className="notification-badge" aria-hidden="true">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="notification-layer">
          <button className="notification-backdrop" type="button" aria-label="Đóng thông báo" onClick={closePanel} />
          <section
            className="notification-panel"
            id={PANEL_ID}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${PANEL_ID}-title`}
            ref={panelRef}
            style={{ "--notification-panel-top": `${panelPosition.top}px`, "--notification-panel-right": `${panelPosition.right}px` }}
          >
            <header className="notification-panel-head">
              <div>
                <h2 id={`${PANEL_ID}-title`} tabIndex="-1" ref={headingRef}>Thông báo</h2>
                <p>{unreadCount ? unreadLabel : "Bạn đã xem hết các cập nhật mới"}</p>
              </div>
              <button type="button" aria-label="Đóng" onClick={closePanel}><ActionIcon name="close" /></button>
            </header>

            <div className="notification-panel-tools">
              <span>Các chuyến bạn đã góp ý</span>
              <button type="button" disabled={!unreadCount || markingAll} onClick={markAllRead}>
                {markingAll ? "Đang đánh dấu…" : "Đánh dấu tất cả đã đọc"}
              </button>
            </div>

            <div className="notification-panel-body" aria-live="polite">
              {loading && !notifications.length && <NotificationSkeleton />}
              {error && !notifications.length && (
                <div className="notification-state is-error" role="alert">
                  <strong>Chưa nối được bảng tin</strong>
                  <p>{error}</p>
                  <button type="button" onClick={() => loadNotifications()}>Thử lại</button>
                </div>
              )}
              {!loading && !error && !notifications.length && (
                <div className="notification-state is-empty">
                  <span className="notification-empty-node" aria-hidden="true" />
                  <strong>Chưa có cập nhật</strong>
                  <p>Khi bạn bè góp ý hoặc admin xử lý đề xuất, thông báo sẽ xuất hiện tại đây.</p>
                </div>
              )}
              {notifications.length > 0 && (
                <ul className="notification-list">
                  {notifications.map((notification) => {
                    const copy = notificationCopy(notification);
                    const target = notification.contribution.activityTitle || "Cả chuyến đi";
                    return (
                      <li className={notification.readAt ? "is-read" : "is-unread"} key={notification.id}>
                        <button type="button" onClick={() => openNotification(notification)}>
                          <span className="notification-route-node" aria-hidden="true" />
                          <span className="notification-item-copy">
                            <span className="notification-item-meta">
                              <strong>{notification.readAt ? "Đã đọc" : "Chưa đọc"}</strong>
                              <time dateTime={notification.createdAt}>{relativeTime(notification.createdAt)}</time>
                            </span>
                            <b>{copy.title}</b>
                            <span className="notification-item-detail">{copy.detail}</span>
                            <small>{notification.trip.title} · {target}</small>
                          </span>
                          <ActionIcon name="right" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {error && notifications.length > 0 && <p className="notification-inline-error" role="alert">{error}</p>}
            </div>

            {nextCursor && (
              <footer className="notification-panel-footer">
                <button type="button" disabled={loadingMore} onClick={() => loadNotifications({ cursor: nextCursor, append: true })}>
                  {loadingMore ? "Đang tải…" : "Xem thêm cập nhật"}
                </button>
              </footer>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function NotificationSkeleton() {
  return (
    <div className="notification-skeleton" aria-label="Đang tải thông báo">
      {[0, 1, 2].map((item) => <span key={item}><i /><b /><small /></span>)}
    </div>
  );
}
