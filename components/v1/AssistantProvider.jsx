"use client";
import { createContext, Suspense, useContext, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Dialog, { DialogTitle } from "../ui/Dialog";
import { apiJson } from "./transport.mjs";
import styles from "./companion.module.css";
const Workspace = dynamic(() => import("./AssistantWorkspace"), { loading: () => <p role="status">Đang mở trợ lý…</p> });
const AssistantContext = createContext(null);
// Isolate URL suspension from the existing page. The tracker must never be
// duplicated or hidden while Next resolves the assistant's query parameters.
function AssistantLocation({ onChange }) {
  const pathname = usePathname(), params = useSearchParams();
  const query = params.toString();
  useEffect(() => { onChange({ pathname, query }); }, [pathname, query, onChange]);
  return null;
}
export function AssistantLauncher({ tripSlug }) {
  const assistant = useContext(AssistantContext);
  if (!assistant?.enabled) return null;
  return <button type="button" className={styles.launcher} onClick={() => assistant.open(tripSlug)}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 4h14v12H9l-4 4V4Z" /><path d="M9 8h6M9 12h4" /></svg>
    Trợ lý{assistant.count > 0 && <span aria-label={`${assistant.count} câu trả lời mới`}>{assistant.count}</span>}
  </button>;
}
export default function AssistantProvider({ viewer, children }) {
  const router = useRouter();
  const [{ pathname, query }, setLocation] = useState({ pathname: "", query: "" });
  const params = new URLSearchParams(query);
  const enabled = !!viewer?.isAdmin;
  const visible = enabled && params.get("chat") === "1" && pathname !== "/assistant";
  const [mobile, setMobile] = useState(false), [count, setCount] = useState(0);
  useEffect(() => {
    const query = matchMedia("(max-width: 1199px)");
    const update = () => setMobile(query.matches);
    update(); query.addEventListener("change", update); return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const runs = await apiJson("/api/v1/assistant/runs", { signal: controller.signal });
        if (!active) return;
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
      } catch { /* Background badges never interrupt the main trip. */ }
    };
    void refresh(); const timer = setInterval(refresh, 5000);
    window.addEventListener("assistant-completed", refresh);
    return () => { active = false; controller.abort(); clearInterval(timer); window.removeEventListener("assistant-completed", refresh); };
  }, [enabled, viewer?.email, visible, pathname]);
  const open = (trip) => {
    const query = new URLSearchParams(); if (trip || params.get("trip")) query.set("trip", trip || params.get("trip")); query.set("chat", "1");
    router.push(`/?${query}`, { scroll: false });
  };
  const close = () => {
    const url = new URL(window.location.href); url.searchParams.delete("chat"); url.searchParams.delete("conversation");
    window.history.replaceState({}, "", url);
    // Next native history integration updates useSearchParams without remounting the tracker.
  };
  const switchTrip = (trip) => router.push(`/?trip=${encodeURIComponent(trip)}&chat=1`, { scroll: false });
  const workspace = visible ? <Workspace viewer={viewer} tripSlug={params.get("trip")} companion onClose={close} onTripChange={switchTrip} /> : null;
  return <AssistantContext.Provider value={{ enabled, count, open }}>
    <Suspense fallback={null}><AssistantLocation onChange={setLocation} /></Suspense>
    <div className={visible && !mobile ? styles.withCompanion : undefined}>{children}</div>
    {visible && (mobile ? <Dialog onClose={close} overlayClassName={styles.mobileOverlay}><div className={styles.mobilePanel}><DialogTitle asChild><span className="sr-only">Trợ lý hành trình</span></DialogTitle>{workspace}</div></Dialog>
      : <aside className={styles.panel} aria-label="Trợ lý cho chuyến đi hiện tại">{workspace}</aside>)}
  </AssistantContext.Provider>;
}
