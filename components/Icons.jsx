export function TypeIcon({ type = "Visit" }) {
  const key = type.toLowerCase();
  if (key.includes("transit") || key.includes("return")) return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="15" rx="2" /><path d="M8 7h8M7 13h10M8 21l2-3m6 3-2-3" /><circle cx="9" cy="15" r="1" /><circle cx="15" cy="15" r="1" /></svg>;
  if (key.includes("walk")) return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4" r="2" /><path d="m10 21 2-7-3-3 3-4 3 3 3 1m-6 3 4 3 1 4M9 11l-3 3" /></svg>;
  if (key.includes("film") || key.includes("photo")) return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="14" height="11" rx="2" /><path d="m17 11 4-2v7l-4-2M7 7l2-3h4l2 3" /><circle cx="10" cy="12.5" r="2.5" /></svg>;
  if (key.includes("rest")) return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h11v7a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8Z" /><path d="M16 10h2a2 2 0 0 1 0 4h-2M7 4v2m4-2v2m4-2v2" /></svg>;
  if (key.includes("reservation") || key.includes("call")) return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7.1 3.5 2.9 3.8-1.8 1.8a15 15 0 0 0 6.7 6.7l1.8-1.8 3.8 2.9c.4.3.5.8.3 1.3-.8 1.7-2.5 2.8-4.3 2.8C9 21 3 15 3 7.5c0-1.8 1.1-3.5 2.8-4.3.5-.2 1 0 1.3.3Z" /></svg>;
  if (key.includes("flight")) return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 14 7-2.5V5.8c0-1.6.9-3.3 2-3.3s2 1.7 2 3.3v5.7l7 2.5v2l-7-.8v3.3l2 1.5v1.5L12 21l-4 .5V20l2-1.5v-3.3l-7 .8v-2Z" /></svg>;
  if (key.includes("dinner")) return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v8m-3-8v5a3 3 0 0 0 6 0V3M7 11v10M16 3v18m0-18c3 2 4 5 4 8h-4" /></svg>;
  if (key.includes("picnic") || key.includes("camp")) return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 8-16 8 16H4Z" /><path d="m8 20 4-8 4 8M5 20h14" /></svg>;
  if (key.includes("buffer")) return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12M6 21h12M8 3v4l4 5-4 5v4m8-18v4l-4 5 4 5v4" /></svg>;
  return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
}

export function ActionIcon({ name }) {
  if (name === "add") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
  if (name === "close") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "copy") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1.5" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></svg>;
  if (name === "external") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-9 9" /><path d="M18 13v6H5V6h6" /></svg>;
  if (name === "down") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
  if (name === "edit") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.5 4 4-.5L19 8.5 15.5 5 4 16.5Z" /><path d="m13.5 7 3.5 3.5" /></svg>;
  if (name === "delete") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" /></svg>;
  if (name === "invite") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.6-3.2 2.4-5 5.5-5s4.9 1.8 5.5 5M18 7v6m-3-3h6" /></svg>;
  if (name === "share") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="5" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4" /></svg>;
  if (name === "check") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" /></svg>;
  if (name === "eye") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
  if (name === "eye-off") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 6.1A10.5 10.5 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.2 2.8M6.4 6.4C3.8 8.1 2.5 12 2.5 12s3.5 6 9.5 6a9.8 9.8 0 0 0 3.2-.5M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>;
  if (name === "more") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></svg>;
  if (name === "bell") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" /><path d="M10 21h4" /></svg>;
  if (name === "moon") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" /></svg>;
  return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>;
}
