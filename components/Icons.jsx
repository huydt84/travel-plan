export function TypeIcon({ type = "Visit" }) {
  const key = type.toLowerCase();
  if (key.includes("transit") || key.includes("return")) return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="15" rx="2" /><path d="M8 7h8M7 13h10M8 21l2-3m6 3-2-3" /><circle cx="9" cy="15" r="1" /><circle cx="15" cy="15" r="1" /></svg>;
  if (key.includes("walk")) return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4" r="2" /><path d="m10 21 2-7-3-3 3-4 3 3 3 1m-6 3 4 3 1 4M9 11l-3 3" /></svg>;
  if (key.includes("film") || key.includes("photo")) return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="14" height="11" rx="2" /><path d="m17 11 4-2v7l-4-2M7 7l2-3h4l2 3" /><circle cx="10" cy="12.5" r="2.5" /></svg>;
  if (key.includes("rest")) return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h11v7a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8Z" /><path d="M16 10h2a2 2 0 0 1 0 4h-2M7 4v2m4-2v2m4-2v2" /></svg>;
  if (key.includes("dinner")) return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v8m-3-8v5a3 3 0 0 0 6 0V3M7 11v10M16 3v18m0-18c3 2 4 5 4 8h-4" /></svg>;
  if (key.includes("buffer")) return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12M6 21h12M8 3v4l4 5-4 5v4m8-18v4l-4 5 4 5v4" /></svg>;
  return <svg className="type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
}

export function ActionIcon({ name }) {
  if (name === "close") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "external") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-9 9" /><path d="M18 13v6H5V6h6" /></svg>;
  if (name === "down") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
  if (name === "invite") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.6-3.2 2.4-5 5.5-5s4.9 1.8 5.5 5M18 7v6m-3-3h6" /></svg>;
  if (name === "check") return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" /></svg>;
  return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>;
}
