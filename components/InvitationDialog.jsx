"use client";

import { signIn } from "next-auth/react";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createInvitationDraft, formatInvitationTripDate } from "../lib/invitation-draft.mjs";
import { ActionIcon } from "./Icons";

import { googleMailConsentParams } from "../lib/google-auth-policy.mjs";
const DRAFT_TTL_MS = 30 * 60 * 1000;
const MAX_RECIPIENTS = 6;

const formatWhen = (value) => value ? new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
}).format(new Date(value)) : "";

const draftKey = (viewer, trip) => `travel-plan:invite:${viewer?.email || "guest"}:${trip.slug}`;

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.3h5.4a4.6 4.6 0 0 1-2 3v2.8h3.5c2-1.9 3.2-4.6 3.2-7.9Z" />
      <path fill="#34A853" d="M12 22c2.9 0 5.3-1 7-2.6l-3.5-2.8a6.3 6.3 0 0 1-9.4-3.3H2.5v2.9A10.6 10.6 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.1 13.3A6.4 6.4 0 0 1 6 9.7v-3H2.5a10 10 0 0 0 0 9.5l3.6-2.9Z" />
      <path fill="#EA4335" d="M12 5.6c1.6 0 3 .5 4.2 1.7l3.1-3A10.5 10.5 0 0 0 2.5 6.7L6 9.7A6.3 6.3 0 0 1 12 5.6Z" />
    </svg>
  );
}

export default function InvitationDialog({ open, onClose, viewer, trip, itinerary, gmailReturn = false }) {
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [recipients, setRecipients] = useState([]);
  const [draft, setDraft] = useState({ subject: "", message: "" });
  const [draftTouched, setDraftTouched] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [portalReady, setPortalReady] = useState(false);
  const dialogRef = useRef(null);
  const emailRef = useRef(null);
  const returnFocusRef = useRef(null);
  const closeFromEscape = useEffectEvent(() => {
    if (!busy) onClose();
  });

  const buildGeneratedDraft = useCallback(() => createInvitationDraft({
    trip,
    itinerary,
    inviter: viewer,
    url: `${window.location.origin}/?trip=${encodeURIComponent(trip.slug)}`,
  }), [itinerary, trip, viewer]);

  const loadAccess = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/invitation-access?tripSlug=${encodeURIComponent(trip.slug)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Không thể tải quyền gửi lời rủ");
      setAccess(payload);
      return payload;
    } catch (loadError) {
      setError(loadError.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [trip.slug]);

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement;
    document.body.classList.add("has-dialog");
    const initializeFrame = window.requestAnimationFrame(() => {
      setPortalReady(true);
      setReceipt(null);
      setError("");
      setNotice("");
      loadAccess();
      const stored = window.sessionStorage.getItem(draftKey(viewer, trip));
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (Date.now() - parsed.savedAt <= DRAFT_TTL_MS) {
            setRecipients(Array.isArray(parsed.recipients) ? parsed.recipients.slice(0, MAX_RECIPIENTS) : []);
            setDraft({ subject: parsed.subject || "", message: parsed.message || "" });
            setDraftTouched(true);
            setDetailsOpen(Boolean(parsed.draftTouched));
            if (parsed.requestId) window.sessionStorage.setItem(`${draftKey(viewer, trip)}:request`, parsed.requestId);
          } else {
            window.sessionStorage.removeItem(draftKey(viewer, trip));
          }
        } catch {
          window.sessionStorage.removeItem(draftKey(viewer, trip));
        }
      } else {
        setDraft(buildGeneratedDraft());
        setDraftTouched(false);
        setDetailsOpen(false);
      }
    });
    return () => {
      window.cancelAnimationFrame(initializeFrame);
      document.body.classList.remove("has-dialog");
      returnFocusRef.current?.focus?.();
    };
  }, [buildGeneratedDraft, loadAccess, open, trip, viewer]);

  useEffect(() => {
    if (!portalReady) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector("button:not(:disabled)")?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [portalReady]);

  useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeFromEscape();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  useEffect(() => {
    if (!open || access?.permission?.status !== "pending") return undefined;
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") loadAccess(); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [open, access?.permission?.status, loadAccess]);

  if (!open || !portalReady) return null;

  const permissionStatus = access?.permission?.status || "not_requested";
  const approved = permissionStatus === "approved";
  const isOwner = Boolean(viewer?.isAdmin || access?.isAdmin || viewer?.isOwner || access?.isOwner);
  const quota = access?.quota;
  const quotaExhausted = quota?.batchesRemaining === 0;
  const typedRecipient = email.trim().toLowerCase();
  const recipientCount = new Set([...recipients, ...(typedRecipient ? [typedRecipient] : [])]).size;
  const gmailNotice = gmailReturn && access
    ? (access.gmailAuthorized
        ? "Gmail đã kết nối — kiểm tra lại trước khi gửi."
        : "Bạn chưa cấp quyền Gmail. Nội dung vẫn được giữ.")
    : "";
  const visibleNotice = notice || gmailNotice;

  const callbackUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("trip", trip.slug);
    url.searchParams.set("invite", "1");
    return url.toString();
  };

  const saveDraft = (draftRecipients = recipients) => {
    const requestKey = `${draftKey(viewer, trip)}:request`;
    const requestId = window.sessionStorage.getItem(requestKey) || crypto.randomUUID();
    window.sessionStorage.setItem(requestKey, requestId);
    window.sessionStorage.setItem(draftKey(viewer, trip), JSON.stringify({
      recipients: draftRecipients,
      subject: draft.subject,
      message: draft.message,
      draftTouched,
      requestId,
      savedAt: Date.now(),
    }));
    return requestId;
  };

  const addEmail = () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    if (!emailRef.current?.checkValidity()) {
      emailRef.current?.reportValidity();
      return;
    }
    if (recipients.includes(normalized)) {
      setError("Email này đã có trong danh sách gửi.");
      return;
    }
    if (recipients.length >= MAX_RECIPIENTS) {
      setError("Mỗi lượt chỉ có thể gửi tối đa 6 người.");
      return;
    }
    setRecipients((current) => [...current, normalized]);
    setEmail("");
    setError("");
    emailRef.current?.focus();
  };

  const requestPermission = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/invitation-access/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripSlug: trip.slug }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Không thể gửi yêu cầu");
      await loadAccess();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const connectGmail = (draftRecipients = recipients) => {
    saveDraft(draftRecipients);
    const url = new URL(callbackUrl());
    url.searchParams.set("gmail", "return");
    window.sessionStorage.setItem("travel-plan:invite:return", url.toString());
    signIn("google", { redirectTo: url.toString() }, googleMailConsentParams);
  };

  const sendInvitations = async (event) => {
    event.preventDefault();
    if (email.trim() && !emailRef.current?.checkValidity()) {
      emailRef.current?.reportValidity();
      return;
    }
    if (email.trim()) addEmail();
    const sendingTo = [...new Set([...recipients, ...(email.trim() ? [email.trim().toLowerCase()] : [])])];
    if (!sendingTo.length) {
      setError("Nhập ít nhất một email muốn rủ.");
      emailRef.current?.focus();
      return;
    }
    if (sendingTo.length > MAX_RECIPIENTS) {
      setError("Mỗi lượt chỉ có thể gửi tối đa 6 người.");
      return;
    }
    if (!access.gmailAuthorized) {
      setRecipients(sendingTo);
      connectGmail(sendingTo);
      return;
    }
    if (!draft.subject.trim() || !draft.message.trim()) {
      setError("Tiêu đề và nội dung email không được để trống.");
      setDetailsOpen(true);
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    const requestId = saveDraft(sendingTo);
    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recipients: sendingTo, requestId, tripSlug: trip.slug, ...draft }),
      });
      const payload = await response.json();
      if (["PERMISSION_REQUIRED", "PERMISSION_PENDING", "PERMISSION_DENIED", "PERMISSION_REVOKED"].includes(payload.code)) {
        await loadAccess();
      }
      if (payload.code === "GMAIL_AUTH_REQUIRED") {
        setAccess((current) => current ? { ...current, gmailAuthorized: false } : current);
      }
      if (payload.history?.length) {
        const failed = payload.history.filter((item) => item.status === "failed").map((item) => item.recipientEmail);
        setRecipients(failed);
      }
      if (!response.ok) throw new Error(payload.error || "Không thể gửi lời rủ lúc này");
      setReceipt({ sent: payload.sent, skipped: payload.skipped || 0, failed: [] });
      setRecipients([]);
      setEmail("");
      window.sessionStorage.removeItem(draftKey(viewer, trip));
      window.sessionStorage.removeItem(`${draftKey(viewer, trip)}:request`);
      const refreshed = await loadAccess();
      if (refreshed) setAccess(refreshed);
    } catch (sendError) {
      setError(sendError.message);
      setDetailsOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => { if (!busy) onClose(); };

  const keepFocusInside = (event) => {
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [href]");
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const renderState = () => {
    if (loading && !access) return <div className="invitation-access-skeleton" aria-label="Đang tải quyền gửi lời rủ"><i /><i /><i /></div>;
    if (!access && error) {
      return (
        <section className="invitation-access-state is-error">
          <h3>Không tải được quyền gửi lời rủ</h3>
          <p>Travel Plan chưa thể kiểm tra quyền của tài khoản này. Thử tải lại trước khi tiếp tục.</p>
        </section>
      );
    }
    if (!access || access.authState === "guest") {
      return (
        <section className="invitation-access-state">
          <h3>Đăng nhập để rủ bạn</h3>
          <p>Đăng nhập để yêu cầu quyền rủ bạn cho chuyến này.</p>
        </section>
      );
    }
    if (permissionStatus === "not_requested") {
      return (
        <section className="invitation-access-state">
          <h3>Xin quyền rủ bạn</h3>
          <p>Lời rủ sẽ được gửi từ Gmail của bạn. Chủ lịch trình cần duyệt trước; Travel Plan chưa yêu cầu quyền Gmail ở bước này.</p>
        </section>
      );
    }
    if (permissionStatus === "pending") {
      return (
        <section className="invitation-access-state is-pending">
          <h3>Đã gửi yêu cầu</h3>
          <p>Chủ lịch trình sẽ xem xét quyền gửi lời rủ của bạn.</p>
          <dl><div><dt>Chuyến đi</dt><dd>{access.permission.requestedTripTitle}</dd></div><div><dt>Gửi lúc</dt><dd>{formatWhen(access.permission.requestedAt)}</dd></div></dl>
        </section>
      );
    }
    if (["denied", "revoked"].includes(permissionStatus)) {
      return (
        <section className="invitation-access-state is-blocked">
          <h3>{permissionStatus === "denied" ? "Yêu cầu chưa được chấp thuận" : "Quyền gửi lời rủ đã bị thu hồi"}</h3>
          <p>{access.permission.decisionReason || "Chủ lịch trình có thể duyệt lại quyền này trong khu vực quản lý."}</p>
          {access.permission.reviewedAt && <small>Cập nhật {formatWhen(access.permission.reviewedAt)}</small>}
        </section>
      );
    }
    if (receipt) {
      return (
        <section className="invitation-receipt" role="status">
          <span className="invitation-receipt-mark"><ActionIcon name="check" /></span>
          <h3>Đã gửi {receipt.sent} lời rủ</h3>
          <p>Mỗi người nhận đã nhận một email riêng từ Gmail của bạn.</p>
        </section>
      );
    }
    return (
      <form className="invitation-sheet-form" onSubmit={sendInvitations} noValidate>
        {visibleNotice && <p className="invitation-sheet-notice" role="status">{visibleNotice}</p>}
        {!access.gmailAuthorized && <p className="invitation-consent-note">Lần gửi đầu tiên sẽ mở Google để bạn cấp quyền gửi email. Bản nháp sẽ được giữ lại.</p>}
        {quotaExhausted && <p className="invitation-quota-alert" role="alert">Bạn đã dùng 20 lượt gửi trong 24 giờ.{quota.resetAt ? ` Có thể gửi lại từ ${formatWhen(quota.resetAt)}.` : ""}</p>}
        <label className="invitation-recipient-label" htmlFor="invite-email">Email người bạn muốn rủ <span>{recipients.length}/{MAX_RECIPIENTS}</span></label>
        <div className="invitation-recipient-entry">
          <input ref={emailRef} id="invite-email" type="email" autoComplete="email" value={email} placeholder="banbe@example.com" disabled={busy || recipients.length >= MAX_RECIPIENTS} onChange={(event) => { setEmail(event.target.value); setError(""); }} onKeyDown={(event) => { if (["Enter", ","].includes(event.key)) { event.preventDefault(); addEmail(); } }} />
          <button type="button" className="admin-ghost" onClick={addEmail} disabled={busy || recipients.length >= MAX_RECIPIENTS}>Thêm</button>
        </div>
        {recipients.length > 0 && <ul className="invitation-recipient-chips">{recipients.map((recipient) => <li key={recipient}><span>{recipient}</span><button type="button" onClick={() => setRecipients((current) => current.filter((item) => item !== recipient))} aria-label={`Bỏ ${recipient}`}><ActionIcon name="close" /></button></li>)}</ul>}
        <details className="invitation-draft-details" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
          <summary>Chỉnh lời nhắn <span>{draftTouched ? "Đã chỉnh" : "Tự tạo từ lịch trình"}</span></summary>
          <div>
            <label htmlFor="invite-subject">Tiêu đề</label>
            <input id="invite-subject" value={draft.subject} maxLength={200} onChange={(event) => { setDraft((current) => ({ ...current, subject: event.target.value })); setDraftTouched(true); }} />
            <label htmlFor="invite-message">Nội dung <span>{draft.message.length}/10000</span></label>
            <textarea id="invite-message" value={draft.message} maxLength={10000} rows={9} onChange={(event) => { setDraft((current) => ({ ...current, message: event.target.value })); setDraftTouched(true); }} />
            <button type="button" className="invitation-reset" onClick={() => { setDraft(buildGeneratedDraft()); setDraftTouched(false); }}>Tạo lại từ lịch trình</button>
          </div>
        </details>
        {access.history?.length > 0 && (
          <details className="invitation-history-details">
            <summary>Lời rủ gần đây <span>{access.history.length}</span></summary>
            <ul>{access.history.map((item) => <li key={item.id}><span><strong>{item.recipientEmail}</strong><small>{formatWhen(item.sentAt || item.attemptedAt)}</small></span><em className={`is-${item.status}`}>{item.status === "sent" ? "Đã gửi" : "Gửi lỗi"}</em></li>)}</ul>
          </details>
        )}
        {error && <p className="invitation-sheet-error" role="alert">{error}</p>}
        <footer className="invitation-sheet-footer">
          <p><strong>{recipientCount} người nhận</strong><span>{quota ? `Còn ${quota.batchesRemaining}/20 lượt gửi` : "Tối đa 6 người mỗi lượt"}</span></p>
          <button className="admin-primary" type="submit" disabled={busy || quotaExhausted || recipientCount === 0}>{busy ? "Đang gửi…" : access.gmailAuthorized ? `Gửi ${recipientCount} lời rủ` : "Tiếp tục với Google"}</button>
        </footer>
      </form>
    );
  };

  const renderStateFooter = () => {
    if (loading && !access) return null;
    if (!access && error) {
      return <><button className="admin-ghost" type="button" onClick={handleClose}>Đóng</button><button className="admin-primary" type="button" onClick={loadAccess}>Thử tải lại</button></>;
    }
    if (!access || access.authState === "guest") {
      return <button className="invitation-google" type="button" onClick={() => signIn("google", { redirectTo: callbackUrl() })}><GoogleIcon /> Đăng nhập với Google</button>;
    }
    if (permissionStatus === "not_requested") {
      return <button className="admin-primary" type="button" onClick={requestPermission} disabled={busy}>{busy ? "Đang gửi yêu cầu…" : "Yêu cầu quyền gửi lời rủ"}</button>;
    }
    if (permissionStatus === "pending") {
      return <><button className="admin-ghost" type="button" onClick={handleClose}>Đóng</button><button className="admin-primary" type="button" onClick={loadAccess} disabled={loading}>{loading ? "Đang kiểm tra…" : "Kiểm tra lại"}</button></>;
    }
    if (["denied", "revoked"].includes(permissionStatus)) {
      return <button className="admin-ghost" type="button" onClick={handleClose}>Đóng</button>;
    }
    if (receipt) {
      return <><button className="admin-ghost" type="button" onClick={handleClose}>Đóng</button><button className="admin-primary" type="button" onClick={() => { setReceipt(null); setDraft(buildGeneratedDraft()); }}>Mời thêm</button></>;
    }
    return null;
  };
  const stateFooter = renderStateFooter();

  return createPortal(
    <div className="invitation-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) handleClose(); }}>
      <section className="invitation-sheet" role="dialog" aria-modal="true" aria-labelledby="invitation-sheet-title" ref={dialogRef} onKeyDown={keepFocusInside}>
        <header className="invitation-sheet-head">
          <div><h2 id="invitation-sheet-title">Rủ bạn đi {trip.location}</h2><p>{trip.title} · {formatInvitationTripDate(trip)}</p></div>
          <button type="button" onClick={handleClose} disabled={busy} aria-label="Đóng lời rủ"><ActionIcon name="close" /></button>
        </header>
        {!isOwner && <ol className="invitation-permission-route" aria-label="Tiến trình mở quyền gửi lời rủ">
          <li className={access?.authState === "authenticated" ? "is-done" : "is-active"}><i /><span>Đăng nhập</span></li>
          <li className={approved ? "is-done" : access?.authState === "authenticated" ? "is-active" : ""}><i /><span>Được duyệt</span></li>
          <li className={access?.gmailAuthorized ? "is-done" : approved ? "is-active" : ""}><i /><span>Gmail</span></li>
        </ol>}
        <div className="invitation-sheet-body">{renderState()}</div>
        {stateFooter && <footer className="invitation-state-footer">{stateFooter}</footer>}
      </section>
    </div>,
    document.body,
  );
}
