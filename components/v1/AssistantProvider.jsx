"use client";
import { createContext, Suspense, useContext, useEffect, useState, useRef, startTransition, addTransitionType, ViewTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Dialog, { DialogTitle } from "../ui/Dialog";
import { useCompanionWidth } from "./useCompanionWidth";
import { apiJson, ASSISTANT_RUNS_CHANGED_EVENT } from "./transport.mjs";
import styles from "./companion.module.css";
import { useLocale } from "../LocaleProvider";
function WorkspaceLoading() {
  const { t } = useLocale();
  return <p role="status">{t("assistant.loading")}</p>;
}
const Workspace = dynamic(() => import("./AssistantWorkspace"), { loading: WorkspaceLoading });
const AssistantContext = createContext(null);
const ACTIVE_RUN_POLL_INTERVAL_MS = 5_000;
const REFRESH_RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
export const useAssistantNavigation = () => useContext(AssistantContext);
// Isolate URL suspension from the existing page. The tracker must never be
// duplicated or hidden while Next resolves the assistant's query parameters.
function AssistantLocation({ onChange }) {
  const pathname = usePathname(), params = useSearchParams();
  const query = params.toString();
  const previousMode = useRef(null);
  useEffect(() => {
    const mode = `${pathname}:${new URLSearchParams(query).get("chat") === "1"}`;
    if (previousMode.current !== mode) {
      startTransition(() => { addTransitionType("assistant-ui"); onChange({ pathname, query }); });
    } else onChange({ pathname, query });
    previousMode.current = mode;
  }, [pathname, query, onChange]);
  return null;
}
export function AssistantLauncher({ tripSlug, className = "" }) {
  const assistant = useContext(AssistantContext);
  const { t } = useLocale();
  const setTrackerTrip = assistant?.setTrackerTrip;
  useEffect(() => { if (tripSlug) setTrackerTrip?.(tripSlug); }, [tripSlug, setTrackerTrip]);
  if (!assistant?.enabled) return null;
  return <button type="button" className={`${styles.launcher} ${className}`} onClick={() => assistant.open(tripSlug)} aria-label={t("assistant.launcherLabel")}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 4h14v12H9l-4 4V4Z" /><path d="M9 8h6M9 12h4" /></svg>
    {t("assistant.launcherLabel")}{assistant.count > 0 && <span aria-label={t("assistant.newAnswers", { count: assistant.count })}>{assistant.count}</span>}
  </button>;
}
export default function AssistantProvider({ viewer, children }) {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [{ query }, setLocation] = useState({ pathname: "", query: "" });
  const params = new URLSearchParams(query);
  const enabled = !!viewer?.isAdmin;
  const visible = enabled && params.get("chat") === "1" && pathname !== "/assistant";
  const [count, setCount] = useState(0);
  const [trackerTrip, setTrackerTrip] = useState(null);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), 180);
    return () => clearTimeout(timer);
  }, [closing]);
  const present = visible || (closing && pathname !== "/assistant");
  const { width, mobile, dragging, separatorProps } = useCompanionWidth();
  const panelStyle = { "--assistant-panel-width": `${width}px` };
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer = null;
    let inFlight = false;
    let refreshQueued = false;
    let failureCount = 0;
    const controller = new AbortController();
    const canRefresh = () => document.visibilityState === "visible" && navigator.onLine !== false;
    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const schedule = (delay) => {
      clearTimer();
      if (!active || !canRefresh()) return;
      timer = window.setTimeout(() => { timer = null; void refresh(); }, delay);
    };
    const refresh = async () => {
      if (!active || !canRefresh()) return;
      if (inFlight) return;
      inFlight = true;
      clearTimer();
      try {
        const runs = await apiJson("/api/v1/assistant/runs", { signal: controller.signal });
        if (!active) return;
        if (!Array.isArray(runs)) throw new Error("Invalid assistant run summary response");
        failureCount = 0;
        window.dispatchEvent(new CustomEvent("assistant-runs", { detail: runs }));
        const key = `assistant:${viewer.email}:seen`;
        let seen = [];
        try { seen = JSON.parse(localStorage.getItem(key) || "[]"); } catch { /* Unread state is best effort. */ }
        const currentConversation = new URL(window.location.href).searchParams.get("conversation");
        const completed = runs.filter((run) => run.status !== "running");
        if (visible || pathname === "/assistant") {
          seen = [...new Set([...seen, ...completed.filter((run) => run.conversationId === currentConversation).map((run) => run.id)])].slice(-200);
          try { localStorage.setItem(key, JSON.stringify(seen)); } catch { /* No notification permission needed. */ }
        }
        setCount(completed.filter((run) => !seen.includes(run.id)).length);
        if (runs.some((run) => run.status === "running")) schedule(ACTIVE_RUN_POLL_INTERVAL_MS);
      } catch {
        if (!active || controller.signal.aborted) return;
        const delay = REFRESH_RETRY_DELAYS_MS[failureCount++];
        if (delay !== undefined) schedule(delay);
      } finally {
        inFlight = false;
        if (refreshQueued) {
          refreshQueued = false;
          if (active && canRefresh()) void refresh();
        }
      }
    };
    const refreshNow = () => {
      failureCount = 0;
      clearTimer();
      if (!inFlight) void refresh();
    };
    const invalidate = () => {
      failureCount = 0;
      clearTimer();
      if (inFlight) refreshQueued = true;
      else void refresh();
    };
    const visibilityChanged = () => {
      if (canRefresh()) refreshNow();
      else clearTimer();
    };
    const wentOffline = () => clearTimer();
    void refresh();
    window.addEventListener(ASSISTANT_RUNS_CHANGED_EVENT, invalidate);
    window.addEventListener("focus", refreshNow);
    window.addEventListener("online", refreshNow);
    window.addEventListener("offline", wentOffline);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      active = false;
      refreshQueued = false;
      controller.abort();
      clearTimer();
      window.removeEventListener(ASSISTANT_RUNS_CHANGED_EVENT, invalidate);
      window.removeEventListener("focus", refreshNow);
      window.removeEventListener("online", refreshNow);
      window.removeEventListener("offline", wentOffline);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [enabled, viewer?.email, visible, pathname]);
  const open = (trip) => {
    setClosing(false);
    const query = new URLSearchParams(); if (trip || params.get("trip")) query.set("trip", trip || params.get("trip")); query.set("chat", "1");
    const conversation = params.get("conversation"); if (conversation) query.set("conversation", conversation);
    if (pathname === "/" && (!trip || trip === trackerTrip)) {
      startTransition(() => {
        addTransitionType("assistant-ui");
        window.history.pushState({}, "", `/?${query}`);
        setLocation({ pathname, query: query.toString() });
      });
    } else router.push(`/?${query}`, { scroll: false, transitionTypes: ["assistant-ui"] });
  };
  const close = () => {
    const url = new URL(window.location.href); url.searchParams.delete("chat"); url.searchParams.delete("conversation");
    window.history.replaceState({}, "", url);
    setClosing(true);
    setLocation({ pathname, query: url.searchParams.toString() });
    // Next native history integration updates useSearchParams without remounting the tracker.
  };
  const workspace = present ? <Workspace viewer={viewer} tripSlug={trackerTrip || params.get("trip")} companion onClose={close} /> : null;
  // Prime the companion query before the route commits so both modes share one snapshot.
  const prepareCompanion = (href) => setLocation({ pathname: "/", query: new URL(href, window.location.origin).searchParams.toString() });
  return <AssistantContext.Provider value={{ enabled, isOwner: Boolean(viewer?.isOwner), count, open, prepareCompanion, setTrackerTrip }}>
    <Suspense fallback={null}><AssistantLocation onChange={setLocation} /></Suspense>
    <ViewTransition name="assistant-itinerary" default="none" update={{ "assistant-ui": "assistant-layout" }}><div className={`${styles.pageLayout} ${visible && !mobile ? styles.withCompanion : ""}`} style={panelStyle} data-resizing={dragging || undefined} data-closing={closing && !visible || undefined}>{children}</div></ViewTransition>
    {present && <ViewTransition name="trip-assistant" default="none" share="assistant-morph" enter="assistant-enter" exit="assistant-exit">{mobile ? <Dialog portal={false} onClose={close} overlayClassName={styles.mobileOverlay}><div className={styles.mobilePanel} data-closing={closing && !visible || undefined} onAnimationEnd={(event) => { if (event.target === event.currentTarget && !visible) setClosing(false); }}><DialogTitle asChild><span className="sr-only">{t("assistantExtra.title")}</span></DialogTitle>{workspace}</div></Dialog>
      : <aside id="trip-companion-panel" className={styles.panel} style={panelStyle} data-resizing={dragging || undefined} aria-label={t("assistantExtra.title")} data-closing={closing && !visible || undefined} onAnimationEnd={(event) => { if (event.target === event.currentTarget && !visible) setClosing(false); }}><div className={styles.resizeHandle} {...separatorProps} />{workspace}</aside>}</ViewTransition>}
  </AssistantContext.Provider>;
}
