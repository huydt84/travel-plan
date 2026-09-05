import { requestJson } from "../../lib/request-json.mjs";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { ActionIcon } from "../Icons";
import ConfirmDialog from "../ConfirmDialog";

const NOTIFICATION_NAVIGATION_EVENT = "travel-plan:notification-navigation";

export function useContributions({ tripSlug, viewer, announce }) {
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionTarget, setSuggestionTarget] = useState(null);
  const [suggestionError, setSuggestionError] = useState("");
  const [suggestionAction, setSuggestionAction] = useState({ id: null, error: "" });
  const [deletionCandidate, setDeletionCandidate] = useState(null);
  const [deletionError, setDeletionError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    requestJson(`/api/trips/${encodeURIComponent(tripSlug)}/suggestions`, { signal: controller.signal })
      .then((result) => setSuggestions(result.suggestions))
      .catch(() => {});
    return () => controller.abort();
  }, [tripSlug]);

  const openSuggestion = (activityId, targetTitle) => {
    if (!viewer) {
      signIn("google", { redirectTo: "/" });
      return;
    }
    setSuggestionError("");
    setSuggestionTarget({ activityId, targetTitle });
  };

  const submitSuggestion = async ({ kind, body }) => {
    const result = await requestJson(`/api/trips/${encodeURIComponent(tripSlug)}/suggestions`, {
      method: "POST",
      body: JSON.stringify({ activityId: suggestionTarget.activityId, kind, body }),
    }, "Không gửi được góp ý");
    setSuggestions((current) => [result, ...current]);
    setSuggestionTarget(null);
  };

  const updateContribution = async (suggestion, patch, message, fallback) => {
    setSuggestionAction({ id: suggestion.id, error: "" });
    try {
      const result = await requestJson(`/api/trips/${encodeURIComponent(tripSlug)}/suggestions/${suggestion.id}`, {
        method: "PATCH", body: JSON.stringify(patch),
      }, fallback);
      setSuggestions((current) => current.map((item) => item.id === suggestion.id ? result : item));
      setSuggestionAction({ id: null, error: "" });
      announce(message);
      return true;
    } catch (error) {
      setSuggestionAction({ id: suggestion.id, error: error.message });
      return false;
    }
  };

  const updateContributionStatus = (suggestion) => updateContribution(
    suggestion, { status: suggestion.status === "resolved" ? "open" : "resolved" },
    suggestion.status === "resolved" ? "Đã mở lại bình luận." : "Đã đánh dấu bình luận là đã xử lý.",
    "Không cập nhật được góp ý",
  );
  const updateContributionVisibility = (suggestion) => updateContribution(
    suggestion, { hidden: !suggestion.hidden },
    suggestion.hidden ? "Đã hiện lại nội dung trên lịch." : "Đã ẩn nội dung khỏi lịch công khai.",
    "Không đổi được hiển thị góp ý",
  );

  const requestDeleteContribution = (suggestion) => {
    setDeletionError("");
    setDeletionCandidate(suggestion);
  };

  const confirmDeleteContribution = async () => {
    const suggestion = deletionCandidate;
    if (!suggestion) return;
    setSuggestionAction({ id: suggestion.id, error: "" });
    setDeletionError("");
    try {
      await requestJson(`/api/trips/${encodeURIComponent(tripSlug)}/suggestions/${suggestion.id}`, { method: "DELETE" }, "Không xoá được góp ý");
      setSuggestions((current) => current.filter((item) => item.id !== suggestion.id));
      setSuggestionAction({ id: null, error: "" });
      setDeletionCandidate(null);
      announce("Đã xoá vĩnh viễn nội dung.");
    } catch (error) {
      setSuggestionAction({ id: null, error: "" });
      setDeletionError(`${error.message}. Hãy thử lại.`);
    }
  };

  const suggestionListProps = {
    action: suggestionAction,
    onDelete: requestDeleteContribution,
    onToggleResolved: updateContributionStatus,
    onToggleVisibility: updateContributionVisibility,
  };

  return {
    suggestions, openSuggestion, listProps: suggestionListProps,
    dialogs: <>
      {suggestionTarget && (
        <SuggestionComposer target={suggestionTarget.targetTitle} error={suggestionError} onClose={() => setSuggestionTarget(null)} onSubmit={async (values) => {
          try { await submitSuggestion(values); }
          catch (error) { setSuggestionError(error.message); }
        }} />
      )}
      {deletionCandidate && (
        <ConfirmDialog
          title="Xoá vĩnh viễn nội dung này?"
          description={`Nội dung của ${deletionCandidate.author.name} sẽ biến mất và không thể khôi phục.`}
          preview={deletionCandidate.body}
          confirmLabel="Xoá vĩnh viễn"
          pendingLabel="Đang xoá…"
          pending={suggestionAction.id === deletionCandidate.id}
          error={deletionError}
          onCancel={() => { setDeletionCandidate(null); setDeletionError(""); }}
          onConfirm={confirmDeleteContribution}
        />
      )}
    </>,
  };
}

export function SuggestionList({ suggestions, action, onDelete, onToggleResolved, onToggleVisibility, anchorItems = true }) {
  const hiddenSuggestions = suggestions.filter((suggestion) => suggestion.hidden);
  const visibleSuggestions = suggestions.filter((suggestion) => !suggestion.hidden);
  const [showHidden, setShowHidden] = useState(false);
  const hiddenToggleRef = useRef(null);

  useEffect(() => {
    if (!hiddenSuggestions.length) return undefined;
    const revealHiddenTarget = (event) => {
      const url = new URL(event?.detail?.targetUrl || window.location.href, window.location.origin);
      const match = url.hash.match(/^#contribution-(\d+)$/);
      if (match && hiddenSuggestions.some((suggestion) => suggestion.id === match[1])) setShowHidden(true);
    };
    const initialReveal = window.setTimeout(revealHiddenTarget, 0);
    window.addEventListener("hashchange", revealHiddenTarget);
    window.addEventListener(NOTIFICATION_NAVIGATION_EVENT, revealHiddenTarget);
    return () => {
      window.clearTimeout(initialReveal);
      window.removeEventListener("hashchange", revealHiddenTarget);
      window.removeEventListener(NOTIFICATION_NAVIGATION_EVENT, revealHiddenTarget);
    };
  }, [hiddenSuggestions]);

  if (!suggestions.length) return null;

  const toggleVisibility = async (suggestion) => {
    const changed = await onToggleVisibility(suggestion);
    if (!changed) return;
    if (!suggestion.hidden) setShowHidden(false);
    window.requestAnimationFrame(() => {
      if (suggestion.hidden && hiddenSuggestions.length === 1) {
        document.getElementById(`contribution-${suggestion.id}`)?.focus();
      } else {
        hiddenToggleRef.current?.focus();
      }
    });
  };

  return (
    <div className="suggestion-list">
      {visibleSuggestions.map((suggestion) => (
        <SuggestionNote suggestion={suggestion} action={action} onDelete={onDelete} onToggleResolved={onToggleResolved} onToggleVisibility={toggleVisibility} anchorItems={anchorItems} key={suggestion.id} />
      ))}
      {hiddenSuggestions.length > 0 && (
        <div className="hidden-suggestion-drawer">
          <button
            type="button"
            className="hidden-suggestion-toggle"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((current) => !current)}
            ref={hiddenToggleRef}
          >
            <span>{hiddenSuggestions.length} nội dung đã ẩn</span>
            <span>{showHidden ? "Thu gọn" : "Xem"}</span>
          </button>
          {showHidden && (
            <div className="hidden-suggestion-list">
              {hiddenSuggestions.map((suggestion) => (
                <SuggestionNote suggestion={suggestion} action={action} onDelete={onDelete} onToggleResolved={onToggleResolved} onToggleVisibility={toggleVisibility} anchorItems={anchorItems} key={suggestion.id} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SuggestionNote({ suggestion, action, onDelete, onToggleResolved, onToggleVisibility, anchorItems }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const menuButtonRef = useRef(null);
  const busy = action.id === suggestion.id;
  const contributionLabel = suggestion.kind === "comment" ? "bình luận" : "đề xuất";

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeMenu = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeFromEscape = (event) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [menuOpen]);

  return (
    <article
      className={`suggestion-note ${suggestion.kind}${suggestion.hidden ? " is-hidden" : ""}`}
      id={anchorItems ? `contribution-${suggestion.id}` : undefined}
      tabIndex={anchorItems ? -1 : undefined}
    >
      <div className="suggestion-note-head">
        <div className="suggestion-note-meta">
          <strong>{suggestion.author.name}</strong>
          <span>{suggestion.kind === "comment" ? "Bình luận" : "Đề xuất"}</span>
          {suggestion.status !== "open" && <span className={`suggestion-status ${suggestion.status}`}>{statusLabel(suggestion.status)}</span>}
          {suggestion.hidden && <span className="suggestion-status hidden">Đã ẩn</span>}
        </div>
      </div>
      <p>{suggestion.body}</p>
      {(suggestion.canManage || suggestion.canChangeVisibility || suggestion.canDelete) && (
        <div className="suggestion-note-actions" role="group" aria-label={`Thao tác với ${contributionLabel} của ${suggestion.author.name}`}>
          {suggestion.canManage && (
            <button
              type="button"
              className={`suggestion-resolve-action${suggestion.status === "resolved" ? " is-complete" : ""}`}
              onClick={() => onToggleResolved(suggestion)}
              disabled={busy}
            >
              <ActionIcon name="check" />
              {suggestion.status === "resolved" ? "Mở lại" : "Đã xử lý"}
            </button>
          )}
          {suggestion.canChangeVisibility && (
            <button className="suggestion-visibility-action" type="button" onClick={() => onToggleVisibility(suggestion)} disabled={busy}>
              <ActionIcon name={suggestion.hidden ? "eye" : "eye-off"} />
              {suggestion.hidden ? "Hiện lại" : "Ẩn"}
            </button>
          )}
          {suggestion.canDelete && (
            <div className="suggestion-more" ref={menuRef}>
              <button
                type="button"
                className="suggestion-more-trigger"
                aria-label={`Thêm thao tác với ${contributionLabel} của ${suggestion.author.name}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="Thêm thao tác"
                onClick={() => setMenuOpen((current) => !current)}
                disabled={busy}
                ref={menuButtonRef}
              >
                <ActionIcon name="more" />
              </button>
              {menuOpen && <div className="suggestion-more-menu" role="menu"><button type="button" className="danger" role="menuitem" onClick={() => onDelete(suggestion)}>Xoá vĩnh viễn</button></div>}
            </div>
          )}
        </div>
      )}
      {busy && !action.error && <p className="suggestion-action-state" role="status">Đang cập nhật…</p>}
      {action.id === suggestion.id && action.error && <p className="suggestion-action-error" role="alert">{action.error}. Hãy thử lại.</p>}
    </article>
  );
}

function SuggestionComposer({ target, error, onClose, onSubmit }) {
  const [kind, setKind] = useState("suggestion");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
  const closeComposer = useEffectEvent(onClose);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    const handleEscape = (event) => { if (event.key === "Escape") closeComposer(); };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      returnFocusRef.current?.focus?.();
    };
  }, []);

  const keepFocusInside = (event) => {
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll("button, select, textarea, [href], input");
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return (
    <div className="suggestion-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="suggestion-composer" role="dialog" aria-modal="true" aria-labelledby="suggestion-dialog-title" ref={dialogRef} onKeyDown={keepFocusInside} onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try { await onSubmit({ kind, body }); }
        finally { setBusy(false); }
      }}>
        <div className="suggestion-composer-head"><h2 id="suggestion-dialog-title">Góp ý: {target}</h2><button type="button" onClick={onClose} aria-label="Đóng"><ActionIcon name="close" /></button></div>
        <label>Loại<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="suggestion">Đề xuất thay đổi</option><option value="comment">Bình luận / ghi chú</option></select></label>
        <label>Nội dung<textarea value={body} onChange={(event) => setBody(event.target.value)} minLength="2" maxLength="2000" rows="5" autoFocus required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="suggestion-composer-actions"><button type="button" className="admin-ghost" onClick={onClose}>Huỷ</button><button className="admin-primary" disabled={busy}>{busy ? "Đang gửi…" : "Gửi góp ý"}</button></div>
      </form>
    </div>
  );
}

const statusLabel = (status) => ({ accepted: "Đã nhận", resolved: "Đã xử lý", rejected: "Từ chối" }[status] || "Mới");

