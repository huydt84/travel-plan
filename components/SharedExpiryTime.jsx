"use client";

import { useEffect, useRef } from "react";

export default function SharedExpiryTime({ expiresAt, intlLocale, label }) {
  const timeRef = useRef(null);

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    timeRef.current.textContent = new Intl.DateTimeFormat(intlLocale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(expiresAt));
  }, [expiresAt, intlLocale]);

  const [before, after] = label.split("{time}");
  return <span>{before}<time ref={timeRef} dateTime={expiresAt}>…</time>{after}</span>;
}
