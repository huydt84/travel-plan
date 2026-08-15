"use client";

import { useEffect } from "react";
import { USER_ACTIVITY_WRITE_INTERVAL_MS } from "../lib/user-activity.mjs";

export default function ActivityHeartbeat() {
  useEffect(() => {
    let lastSuccessfulHeartbeat = 0;
    let requestInFlight = false;
    let stopped = false;

    const stop = () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sendHeartbeat);
      window.removeEventListener("focus", sendHeartbeat);
    };

    const sendHeartbeat = async () => {
      if (stopped || requestInFlight || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastSuccessfulHeartbeat < USER_ACTIVITY_WRITE_INTERVAL_MS) return;

      requestInFlight = true;
      try {
        const response = await fetch("/api/activity", {
          method: "POST",
          cache: "no-store",
          keepalive: true,
        });
        if (response.status === 401) {
          stop();
          return;
        }
        if (response.ok) lastSuccessfulHeartbeat = now;
      } catch {
        return;
      } finally {
        requestInFlight = false;
      }
    };

    const timer = window.setInterval(sendHeartbeat, USER_ACTIVITY_WRITE_INTERVAL_MS);
    void sendHeartbeat();
    document.addEventListener("visibilitychange", sendHeartbeat);
    window.addEventListener("focus", sendHeartbeat);

    return stop;
  }, []);

  return null;
}
