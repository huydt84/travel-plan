"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale } from "../LocaleProvider";

const storageKey = "assistant:panel-width";
const minimum = 360;
const subscribeViewport = (notify) => {
  window.addEventListener("resize", notify);
  return () => window.removeEventListener("resize", notify);
};
const getViewport = () => window.innerWidth;
const getServerViewport = () => 0;
const readPreference = () => {
  try {
    const saved = Number(localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved >= minimum && saved <= 960 ? saved : null;
  } catch { return null; }
};

export function useCompanionWidth() {
  const { t } = useLocale();
  const viewport = useSyncExternalStore(subscribeViewport, getViewport, getServerViewport);
  const [preferred, setPreferred] = useState(undefined);
  const preference = preferred === undefined && viewport ? readPreference() : preferred;
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const fallback = viewport >= 1800 ? 600 : 480;
  const maximum = Math.max(minimum, Math.min(960, viewport - 640));
  const width = viewport ? Math.min(maximum, Math.max(minimum, preference ?? fallback)) : fallback;
  const mobile = viewport > 0 && viewport < 1200;

  useEffect(() => {
    const cancelDrag = () => { drag.current = null; setDragging(false); };
    window.addEventListener("resize", cancelDrag);
    return () => window.removeEventListener("resize", cancelDrag);
  }, []);

  const change = (next, persist = false) => {
    const clamped = Math.min(maximum, Math.max(minimum, next));
    setPreferred(clamped);
    if (persist) {
      try { localStorage.setItem(storageKey, String(clamped)); } catch { /* Best-effort preference. */ }
    }
    return clamped;
  };
  const reset = () => {
    setPreferred(null);
    try { localStorage.removeItem(storageKey); } catch { /* Best-effort preference. */ }
  };
  const finish = (event) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    change(drag.current.latest, true);
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return { width, mobile, dragging, separatorProps: {
    role: "separator", tabIndex: 0, "aria-label": t("assistantExtra.width"), "aria-orientation": "vertical",
    "aria-valuemin": minimum, "aria-valuemax": maximum, "aria-valuenow": width,
    "aria-valuetext": t("assistantExtra.widthPixels", { width }), "aria-controls": "trip-companion-panel",
    title: t("assistantExtra.widthHelp"),
    onPointerDown(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, x: event.clientX, width, latest: width };
      setDragging(true);
    },
    onPointerMove(event) {
      if (!drag.current || drag.current.pointerId !== event.pointerId) return;
      drag.current.latest = change(drag.current.width + drag.current.x - event.clientX);
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    onDoubleClick: reset,
    onKeyDown(event) {
      if (event.key === "Escape" && drag.current) {
        const { width: original, pointerId } = drag.current;
        drag.current = null;
        setDragging(false);
        change(original);
        event.currentTarget.releasePointerCapture(pointerId);
        event.preventDefault();
        return;
      }
      const step = event.shiftKey ? 80 : 24;
      const next = { ArrowLeft: width + step, ArrowRight: width - step, Home: minimum, End: maximum }[event.key];
      if (next !== undefined) { event.preventDefault(); change(next, true); }
      else if (event.key === "Enter") { event.preventDefault(); reset(); }
    },
  } };
}
