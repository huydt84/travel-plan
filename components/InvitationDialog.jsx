"use client";
import Footer from "./ui/Footer";
import styles from "./InvitationDialog.module.css";
import Button from "./ui/Button";

import { signIn } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import Dialog, { DialogTitle } from "./ui/Dialog";
import {
  createInvitationDraft,
  formatInvitationTripDate,
} from "../lib/invitation-draft.mjs";
import { ActionIcon } from "./Icons";
import LanguageSwitcher from "./LanguageSwitcher";
import { useLocale } from "./LocaleProvider";
import { invitationErrorText } from "../lib/i18n-invitations.mjs";

import { googleMailConsentParams } from "../lib/google-auth-policy.mjs";
const DRAFT_TTL_MS = 30 * 60 * 1000;
const MAX_RECIPIENTS = 6;

const formatWhen = (value, locale = "vi-VN") =>
  value
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        hour12: false,
        timeZone: "Asia/Tokyo",
      }).format(new Date(value))
    : "";

const draftKey = (viewer, trip) =>
  `travel-plan:invite:${viewer?.email || "guest"}:${trip.slug}`;

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <path
        fill="#4285F4"
        d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.3h5.4a4.6 4.6 0 0 1-2 3v2.8h3.5c2-1.9 3.2-4.6 3.2-7.9Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.9 0 5.3-1 7-2.6l-3.5-2.8a6.3 6.3 0 0 1-9.4-3.3H2.5v2.9A10.6 10.6 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.1 13.3A6.4 6.4 0 0 1 6 9.7v-3H2.5a10 10 0 0 0 0 9.5l3.6-2.9Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.6c1.6 0 3 .5 4.2 1.7l3.1-3A10.5 10.5 0 0 0 2.5 6.7L6 9.7A6.3 6.3 0 0 1 12 5.6Z"
      />
    </svg>
  );
}

export default function InvitationDialog({
  open,
  onClose,
  viewer,
  trip,
  itinerary,
  gmailReturn = false,
}) {
  const { t, intlLocale, locale } = useLocale();
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
  const emailRef = useRef(null);
  const initializedDraftRef = useRef(null);
  const buildGeneratedDraft = useCallback(
    () =>
      createInvitationDraft({
        trip,
        itinerary,
        inviter: viewer,
        url: `${window.location.origin}/?trip=${encodeURIComponent(trip.slug)}`,
      }),
    [itinerary, trip, viewer],
  );

  const loadAccess = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/invitation-access?tripSlug=${encodeURIComponent(trip.slug)}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "invitationsExtra.loadAccessError");
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
    if (!open) {
      initializedDraftRef.current = null;
      return undefined;
    }
    const initializeFrame = window.requestAnimationFrame(() => {
      // Background itinerary refreshes replace props, but must not reset an open draft.
      const key = draftKey(viewer, trip);
      if (initializedDraftRef.current === key) return;
      initializedDraftRef.current = key;
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
            setRecipients(
              Array.isArray(parsed.recipients)
                ? parsed.recipients.slice(0, MAX_RECIPIENTS)
                : [],
            );
            setDraft({
              subject: parsed.subject || "",
              message: parsed.message || "",
            });
            setDraftTouched(true);
            setDetailsOpen(Boolean(parsed.draftTouched));
            if (parsed.requestId)
              window.sessionStorage.setItem(
                `${draftKey(viewer, trip)}:request`,
                parsed.requestId,
              );
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
    };
  }, [buildGeneratedDraft, loadAccess, open, trip, viewer]);

  useEffect(() => {
    if (!open || access?.permission?.status !== "pending") return undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") loadAccess();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () =>
      document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [open, access?.permission?.status, loadAccess]);

  if (!open || !portalReady) return null;

  const permissionStatus = access?.permission?.status || "not_requested";
  const approved = permissionStatus === "approved";
  const isOwner = Boolean(
    viewer?.isAdmin || access?.isAdmin || viewer?.isOwner || access?.isOwner,
  );
  const quota = access?.quota;
  const quotaExhausted = quota?.batchesRemaining === 0;
  const typedRecipient = email.trim().toLowerCase();
  const recipientCount = new Set([
    ...recipients,
    ...(typedRecipient ? [typedRecipient] : []),
  ]).size;
  const gmailNotice =
    gmailReturn && access
      ? access.gmailAuthorized
        ? t("invitationsExtra.gmailConnected")
        : t("invitationsExtra.gmailNotConnected")
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
    const requestId =
      window.sessionStorage.getItem(requestKey) || crypto.randomUUID();
    window.sessionStorage.setItem(requestKey, requestId);
    window.sessionStorage.setItem(
      draftKey(viewer, trip),
      JSON.stringify({
        recipients: draftRecipients,
        subject: draft.subject,
        message: draft.message,
        draftTouched,
        requestId,
        savedAt: Date.now(),
      }),
    );
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
      setError("invitationsExtra.duplicateEmail");
      return;
    }
    if (recipients.length >= MAX_RECIPIENTS) {
      setError("invitationsExtra.recipientLimit");
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
      if (!response.ok)
        throw new Error(payload.error || "invitationsExtra.requestError");
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
    const sendingTo = [
      ...new Set([
        ...recipients,
        ...(email.trim() ? [email.trim().toLowerCase()] : []),
      ]),
    ];
    if (!sendingTo.length) {
      setError("invitationsExtra.emailRequired");
      emailRef.current?.focus();
      return;
    }
    if (sendingTo.length > MAX_RECIPIENTS) {
      setError("invitationsExtra.recipientLimit");
      return;
    }
    if (!access.gmailAuthorized) {
      setRecipients(sendingTo);
      connectGmail(sendingTo);
      return;
    }
    if (!draft.subject.trim() || !draft.message.trim()) {
      setError("invitationsExtra.draftRequired");
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
        body: JSON.stringify({
          recipients: sendingTo,
          requestId,
          tripSlug: trip.slug,
          ...draft,
        }),
      });
      const payload = await response.json();
      if (
        [
          "PERMISSION_REQUIRED",
          "PERMISSION_PENDING",
          "PERMISSION_DENIED",
          "PERMISSION_REVOKED",
        ].includes(payload.code)
      ) {
        await loadAccess();
      }
      if (payload.code === "GMAIL_AUTH_REQUIRED") {
        setAccess((current) =>
          current ? { ...current, gmailAuthorized: false } : current,
        );
      }
      if (payload.history?.length) {
        const failed = payload.history
          .filter((item) => item.status === "failed")
          .map((item) => item.recipientEmail);
        setRecipients(failed);
      }
      if (!response.ok)
        throw new Error(payload.error || "invitationsExtra.sendError");
      setReceipt({
        sent: payload.sent,
        skipped: payload.skipped || 0,
        failed: [],
      });
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

  const handleClose = () => {
    if (!busy) onClose();
  };

  const renderState = () => {
    if (loading && !access)
      return (
        <div
          className={styles["invitation-access-skeleton"]}
          aria-label={t("invitationsExtra.loadingAccess")}
        >
          <i />
          <i />
          <i />
        </div>
      );
    if (!access && error) {
      return (
        <section className={`${styles["invitation-access-state"]} is-error`}>
          <h3>{t("invitationsExtra.accessFailed")}</h3>
          <p>{t("invitationsExtra.accessFailedHelp")}
          </p>
        </section>
      );
    }
    if (!access || access.authState === "guest") {
      return (
        <section className={styles["invitation-access-state"]}>
          <h3>{t("invitationsExtra.loginTitle")}</h3>
          <p>{t("invitationsExtra.loginHelp")}</p>
        </section>
      );
    }
    if (permissionStatus === "not_requested") {
      return (
        <section className={styles["invitation-access-state"]}>
          <h3>{t("invitationsExtra.askPermission")}</h3>
          <p>{t("invitationsExtra.askPermissionHelp")}
          </p>
        </section>
      );
    }
    if (permissionStatus === "pending") {
      return (
        <section className={`${styles["invitation-access-state"]} is-pending`}>
          <h3>{t("invitationsExtra.requestSent")}</h3>
          <p>{t("invitationsExtra.pendingHelp")}</p>
          <dl>
            <div>
              <dt>{t("invitationsExtra.trip")}</dt>
              <dd>{access.permission.requestedTripTitle}</dd>
            </div>
            <div>
              <dt>{t("invitationsExtra.sentAt")}</dt>
              <dd>{formatWhen(access.permission.requestedAt, intlLocale)}</dd>
            </div>
          </dl>
        </section>
      );
    }
    if (["denied", "revoked"].includes(permissionStatus)) {
      return (
        <section className={`${styles["invitation-access-state"]} is-blocked`}>
          <h3>
            {permissionStatus === "denied"
              ? t("invitationsExtra.deniedTitle")
              : t("invitationsExtra.revokedTitle")}
          </h3>
          <p>
            {access.permission.decisionReason ||
              t("invitationsExtra.reviewHelp")}
          </p>
          {access.permission.reviewedAt && (
            <small>{t("common.updatedAt", { time: formatWhen(access.permission.reviewedAt, intlLocale) })}</small>
          )}
        </section>
      );
    }
    if (receipt) {
      return (
        <section className={styles["invitation-receipt"]} role="status">
          <span className={styles["invitation-receipt-mark"]}>
            <ActionIcon name="check" />
          </span>
          <h3>{t("invitationsExtra.receipt", { count: receipt.sent })}</h3>
          <p>{t("invitationsExtra.receiptHelp")}</p>
        </section>
      );
    }
    return (
      <form
        className={styles["invitation-sheet-form"]}
        onSubmit={sendInvitations}
        noValidate
      >
        {visibleNotice && (
          <p className={styles["invitation-sheet-notice"]} role="status">
            {visibleNotice}
          </p>
        )}
        {!access.gmailAuthorized && (
          <p className={styles["invitation-consent-note"]}>{t("invitationsExtra.consentHelp")}
          </p>
        )}
        {quotaExhausted && (
          <p className={styles["invitation-quota-alert"]} role="alert">{t("invitationsExtra.quotaExhausted")}
            {quota.resetAt
              ? ` ${t("invitation.resendAt", { time: formatWhen(quota.resetAt, intlLocale) })}`
              : ""}
          </p>
        )}
        <label
          className={styles["invitation-recipient-label"]}
          htmlFor="invite-email"
        >{t("invitationsExtra.recipientEmail")}{" "}
          <span>
            {recipients.length}/{MAX_RECIPIENTS}
          </span>
        </label>
        <div className={styles["invitation-recipient-entry"]}>
          <input
            ref={emailRef}
            id="invite-email"
            type="email"
            autoComplete="email"
            value={email}
            placeholder="banbe@example.com"
            disabled={busy || recipients.length >= MAX_RECIPIENTS}
            onChange={(event) => {
              setEmail(event.target.value);
              setError("");
            }}
            onKeyDown={(event) => {
              if (["Enter", ","].includes(event.key)) {
                event.preventDefault();
                addEmail();
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={addEmail}
            disabled={busy || recipients.length >= MAX_RECIPIENTS}
          >{t("invitationsExtra.add")}
          </Button>
        </div>
        {recipients.length > 0 && (
          <ul className={styles["invitation-recipient-chips"]}>
            {recipients.map((recipient) => (
              <li key={recipient}>
                <span>{recipient}</span>
                <button
                  type="button"
                  onClick={() =>
                    setRecipients((current) =>
                      current.filter((item) => item !== recipient),
                    )
                  }
                  aria-label={t("invitationsExtra.removeRecipient", { recipient })}
                >
                  <ActionIcon name="close" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <details
          className={styles["invitation-draft-details"]}
          open={detailsOpen}
          onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        >
          <summary>{t("invitationsExtra.editMessage")}{" "}
            <span>{draftTouched ? t("invitationsExtra.edited") : t("invitationsExtra.generated")}</span>
          </summary>
          <div>
            <label htmlFor="invite-subject">{t("invitationsExtra.subject")}</label>
            <input
              id="invite-subject"
              value={draft.subject}
              maxLength={200}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  subject: event.target.value,
                }));
                setDraftTouched(true);
              }}
            />
            <label htmlFor="invite-message">{t("invitationsExtra.message")} <span>{draft.message.length}/10000</span>
            </label>
            <textarea
              id="invite-message"
              value={draft.message}
              maxLength={10000}
              rows={9}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  message: event.target.value,
                }));
                setDraftTouched(true);
              }}
            />
            <button
              type="button"
              className={styles["invitation-reset"]}
              onClick={() => {
                setDraft(buildGeneratedDraft());
                setDraftTouched(false);
              }}
            >{t("invitationsExtra.regenerate")}
            </button>
          </div>
        </details>
        {access.history?.length > 0 && (
          <details className={styles["invitation-history-details"]}>
            <summary>{t("invitationsExtra.recent")} <span>{access.history.length}</span>
            </summary>
            <ul>
              {access.history.map((item) => (
                <li key={item.id}>
                  <span>
                    <strong>{item.recipientEmail}</strong>
                    <small>{formatWhen(item.sentAt || item.attemptedAt, intlLocale)}</small>
                  </span>
                  <em className={`is-${item.status}`}>
                    {item.status === "sent" ? t("invitationsExtra.sent") : t("invitationsExtra.failed")}
                  </em>
                </li>
              ))}
            </ul>
          </details>
        )}
        {error && (
          <p className={styles["invitation-sheet-error"]} role="alert">
            {invitationErrorText(t, locale, error, "invitationsExtra.sendError")}
          </p>
        )}
        <Footer className={styles["invitation-sheet-footer"]}>
          <p>
            <strong>{t("invitationsExtra.recipientCount", { count: recipientCount })}</strong>
            <span>
              {quota
                ? t("invitationsExtra.quotaRemaining", { count: quota.batchesRemaining })
                : t("invitationsExtra.maxRecipients")}
            </span>
          </p>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || quotaExhausted || recipientCount === 0}
          >
            {busy
              ? t("invitationsExtra.sending")
              : access.gmailAuthorized
                ? t("invitationsExtra.sendCount", { count: recipientCount })
                : t("invitationsExtra.continueGoogle")}
          </Button>
        </Footer>
      </form>
    );
  };

  const renderStateFooter = () => {
    if (loading && !access) return null;
    if (!access && error) {
      return (
        <>
          <Button variant="ghost" type="button" onClick={handleClose}>{t("invitationsExtra.close")}
          </Button>
          <Button variant="primary" type="button" onClick={loadAccess}>{t("invitationsExtra.retryLoad")}
          </Button>
        </>
      );
    }
    if (!access || access.authState === "guest") {
      return (
        <button
          className={styles["invitation-google"]}
          type="button"
          onClick={() => signIn("google", { redirectTo: callbackUrl() })}
        >
          <GoogleIcon />{" "}{t("invitationsExtra.loginGoogle")}
        </button>
      );
    }
    if (permissionStatus === "not_requested") {
      return (
        <Button
          variant="primary"
          type="button"
          onClick={requestPermission}
          disabled={busy}
        >
          {busy ? t("invitationsExtra.requesting") : t("invitationsExtra.requestPermission")}
        </Button>
      );
    }
    if (permissionStatus === "pending") {
      return (
        <>
          <Button variant="ghost" type="button" onClick={handleClose}>{t("invitationsExtra.close")}
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={loadAccess}
            disabled={loading}
          >
            {loading ? t("invitationsExtra.checking") : t("invitationsExtra.checkAgain")}
          </Button>
        </>
      );
    }
    if (["denied", "revoked"].includes(permissionStatus)) {
      return (
        <Button variant="ghost" type="button" onClick={handleClose}>{t("invitationsExtra.close")}
        </Button>
      );
    }
    if (receipt) {
      return (
        <>
          <Button variant="ghost" type="button" onClick={handleClose}>{t("invitationsExtra.close")}
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={() => {
              setReceipt(null);
              setDraft(buildGeneratedDraft());
            }}
          >{t("invitationsExtra.inviteMore")}
          </Button>
        </>
      );
    }
    return null;
  };
  const stateFooter = renderStateFooter();

  return (
    <Dialog
      onClose={handleClose}
      pending={busy}
      overlayClassName={styles["invitation-overlay"]}
    >
      <section className={styles["invitation-sheet"]}>
        <header className={styles["invitation-sheet-head"]}>
          <div>
            <DialogTitle asChild>
              <h2>{t("invitationsExtra.inviteLocation", { location: trip.location })}</h2>
            </DialogTitle>
            <p>
              {trip.title} · {formatInvitationTripDate(trip, intlLocale)}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            aria-label={t("invitation.close")}
          >
            <ActionIcon name="close" />
          </button>
          <LanguageSwitcher />
        </header>
        {!isOwner && (
          <ol
            className={styles["invitation-permission-route"]}
            aria-label={t("invitationsExtra.permissionProgress")}
          >
            <li
              className={
                access?.authState === "authenticated" ? "is-done" : "is-active"
              }
            >
              <i />
              <span>{t("invitationsExtra.login")}</span>
            </li>
            <li
              className={
                approved
                  ? "is-done"
                  : access?.authState === "authenticated"
                    ? "is-active"
                    : ""
              }
            >
              <i />
              <span>{t("invitationsExtra.permissionGranted")}</span>
            </li>
            <li
              className={
                access?.gmailAuthorized
                  ? "is-done"
                  : approved
                    ? "is-active"
                    : ""
              }
            >
              <i />
              <span>Gmail</span>
            </li>
          </ol>
        )}
        <div className={styles["invitation-sheet-body"]}>
          {renderState()}
          {error && !approved && (
            <p className={styles["invitation-sheet-error"]} role="alert">
              {invitationErrorText(t, locale, error, access ? "invitationsExtra.requestError" : "invitationsExtra.loadAccessError")}
            </p>
          )}
        </div>
        {stateFooter && (
          <Footer className={styles["invitation-state-footer"]}>
            {stateFooter}
          </Footer>
        )}
      </section>
    </Dialog>
  );
}
