"use client";
import { useLocale } from "../LocaleProvider";
import contributionsStyles from "../../src/styles/contributions.module.css";

import Button from "../ui/Button";
import { requestJson } from "../../lib/request-json.mjs";
import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { ActionIcon } from "../Icons";
import ConfirmDialog from "../ConfirmDialog";
import Dialog, { DialogTitle } from "../ui/Dialog";

const NOTIFICATION_NAVIGATION_EVENT = "travel-plan:notification-navigation";

export function useContributions({ tripSlug, viewer, announce }) {
  const { t } = useLocale();
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionTarget, setSuggestionTarget] = useState(null);
  const [suggestionError, setSuggestionError] = useState("");
  const [suggestionAction, setSuggestionAction] = useState({
    id: null,
    error: "",
  });
  const [deletionCandidate, setDeletionCandidate] = useState(null);
  const [deletionError, setDeletionError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    requestJson(`/api/trips/${encodeURIComponent(tripSlug)}/suggestions`, {
      signal: controller.signal,
    })
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
    const result = await requestJson(
      `/api/trips/${encodeURIComponent(tripSlug)}/suggestions`,
      {
        method: "POST",
        body: JSON.stringify({
          activityId: suggestionTarget.activityId,
          kind,
          body,
        }),
      },
      t("trackerExtra.sendError"),
    );
    setSuggestions((current) => [result, ...current]);
    setSuggestionTarget(null);
  };

  const updateContribution = async (suggestion, patch, message, fallback) => {
    setSuggestionAction({ id: suggestion.id, error: "" });
    try {
      const result = await requestJson(
        `/api/trips/${encodeURIComponent(tripSlug)}/suggestions/${suggestion.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(patch),
        },
        fallback,
      );
      setSuggestions((current) =>
        current.map((item) => (item.id === suggestion.id ? result : item)),
      );
      setSuggestionAction({ id: null, error: "" });
      announce(message);
      return true;
    } catch (error) {
      setSuggestionAction({ id: suggestion.id, error: error.message || fallback });
      return false;
    }
  };

  const updateContributionStatus = (suggestion) =>
    updateContribution(
      suggestion,
      { status: suggestion.status === "resolved" ? "open" : "resolved" },
      suggestion.status === "resolved"
        ? t("trackerExtra.reopened")
        : t("trackerExtra.resolvedNotice"),
      t("trackerExtra.updateError"),
    );
  const updateContributionVisibility = (suggestion) =>
    updateContribution(
      suggestion,
      { hidden: !suggestion.hidden },
      suggestion.hidden
        ? t("trackerExtra.shownNotice")
        : t("trackerExtra.hiddenNotice"),
      t("trackerExtra.visibilityError"),
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
      await requestJson(
        `/api/trips/${encodeURIComponent(tripSlug)}/suggestions/${suggestion.id}`,
        { method: "DELETE" },
        t("trackerExtra.deleteError"),
      );
      setSuggestions((current) =>
        current.filter((item) => item.id !== suggestion.id),
      );
      setSuggestionAction({ id: null, error: "" });
      setDeletionCandidate(null);
      announce(t("trackerExtra.deletedNotice"));
    } catch (error) {
      setSuggestionAction({ id: null, error: "" });
      setDeletionError(t("trackerExtra.retry", { error: error.message || t("trackerExtra.deleteError") }));
    }
  };

  const suggestionListProps = {
    action: suggestionAction,
    onDelete: requestDeleteContribution,
    onToggleResolved: updateContributionStatus,
    onToggleVisibility: updateContributionVisibility,
  };

  return {
    suggestions,
    openSuggestion,
    listProps: suggestionListProps,
    dialogs: (
      <>
        {suggestionTarget && (
          <SuggestionComposer
            target={suggestionTarget.targetTitle}
            error={suggestionError}
            onClose={() => setSuggestionTarget(null)}
            onSubmit={async (values) => {
              try {
                await submitSuggestion(values);
              } catch (error) {
                setSuggestionError(error.message || t("trackerExtra.sendError"));
              }
            }}
          />
        )}
        {deletionCandidate && (
          <ConfirmDialog
            title={t("trackerExtra.deleteTitle")}
            description={t("trackerExtra.deleteDescription", { name: deletionCandidate.author.name })}
            preview={deletionCandidate.body}
            confirmLabel={t("trackerExtra.delete")}
            pendingLabel={t("trackerExtra.deleting")}
            pending={suggestionAction.id === deletionCandidate.id}
            error={deletionError}
            onCancel={() => {
              setDeletionCandidate(null);
              setDeletionError("");
            }}
            onConfirm={confirmDeleteContribution}
          />
        )}
      </>
    ),
  };
}

export function SuggestionList({
  suggestions,
  action,
  onDelete,
  onToggleResolved,
  onToggleVisibility,
  anchorItems = true,
}) {
  const { t } = useLocale();
  const hiddenSuggestions = suggestions.filter(
    (suggestion) => suggestion.hidden,
  );
  const visibleSuggestions = suggestions.filter(
    (suggestion) => !suggestion.hidden,
  );
  const [showHidden, setShowHidden] = useState(false);
  const hiddenToggleRef = useRef(null);

  useEffect(() => {
    if (!hiddenSuggestions.length) return undefined;
    const revealHiddenTarget = (event) => {
      const url = new URL(
        event?.detail?.targetUrl || window.location.href,
        window.location.origin,
      );
      const match = url.hash.match(/^#contribution-(\d+)$/);
      if (
        match &&
        hiddenSuggestions.some((suggestion) => suggestion.id === match[1])
      )
        setShowHidden(true);
    };
    const initialReveal = window.setTimeout(revealHiddenTarget, 0);
    window.addEventListener("hashchange", revealHiddenTarget);
    window.addEventListener(NOTIFICATION_NAVIGATION_EVENT, revealHiddenTarget);
    return () => {
      window.clearTimeout(initialReveal);
      window.removeEventListener("hashchange", revealHiddenTarget);
      window.removeEventListener(
        NOTIFICATION_NAVIGATION_EVENT,
        revealHiddenTarget,
      );
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
    <div className={contributionsStyles["suggestion-list"]}>
      {visibleSuggestions.map((suggestion) => (
        <SuggestionNote
          suggestion={suggestion}
          action={action}
          onDelete={onDelete}
          onToggleResolved={onToggleResolved}
          onToggleVisibility={toggleVisibility}
          anchorItems={anchorItems}
          key={suggestion.id}
        />
      ))}
      {hiddenSuggestions.length > 0 && (
        <div className={contributionsStyles["hidden-suggestion-drawer"]}>
          <button
            type="button"
            className={contributionsStyles["hidden-suggestion-toggle"]}
            aria-expanded={showHidden}
            onClick={() => setShowHidden((current) => !current)}
            ref={hiddenToggleRef}
          >
            <span>{t("trackerExtra.hiddenCount", { count: hiddenSuggestions.length })}</span>
            <span>{showHidden ? t("trackerExtra.collapse") : t("trackerExtra.view")}</span>
          </button>
          {showHidden && (
            <div className={contributionsStyles["hidden-suggestion-list"]}>
              {hiddenSuggestions.map((suggestion) => (
                <SuggestionNote
                  suggestion={suggestion}
                  action={action}
                  onDelete={onDelete}
                  onToggleResolved={onToggleResolved}
                  onToggleVisibility={toggleVisibility}
                  anchorItems={anchorItems}
                  key={suggestion.id}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SuggestionNote({
  suggestion,
  action,
  onDelete,
  onToggleResolved,
  onToggleVisibility,
  anchorItems,
}) {
  const { t } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const menuButtonRef = useRef(null);
  const busy = action.id === suggestion.id;
  const contributionLabel =
    suggestion.kind === "comment" ? t("trackerExtra.commentLower") : t("trackerExtra.suggestionLower");

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
      className={`${contributionsStyles["suggestion-note"]} ${suggestion.kind}${suggestion.hidden ? " is-hidden" : ""}`}
      id={anchorItems ? `contribution-${suggestion.id}` : undefined}
      tabIndex={anchorItems ? -1 : undefined}
    >
      <div className={contributionsStyles["suggestion-note-head"]}>
        <div className={contributionsStyles["suggestion-note-meta"]}>
          <strong>{suggestion.author.name}</strong>
          <span>{suggestion.kind === "comment" ? t("trackerExtra.comment") : t("trackerExtra.suggestion")}</span>
          {suggestion.status !== "open" && (
            <span
              className={`${contributionsStyles["suggestion-status"]} ${suggestion.status}`}
            >
              {statusLabel(suggestion.status, t)}
            </span>
          )}
          {suggestion.hidden && (
            <span
              className={`${contributionsStyles["suggestion-status"]} hidden`}
            >
              {t("trackerExtra.hidden")}
            </span>
          )}
        </div>
      </div>
      <p>{suggestion.body}</p>
      {(suggestion.canManage ||
        suggestion.canChangeVisibility ||
        suggestion.canDelete) && (
        <div
          className={contributionsStyles["suggestion-note-actions"]}
          role="group"
          aria-label={t("trackerExtra.actions", { kind: contributionLabel, name: suggestion.author.name })}
        >
          {suggestion.canManage && (
            <button
              type="button"
              className={`${contributionsStyles["suggestion-resolve-action"]}${suggestion.status === "resolved" ? " is-complete" : ""}`}
              onClick={() => onToggleResolved(suggestion)}
              disabled={busy}
            >
              <ActionIcon name="check" />
              {suggestion.status === "resolved" ? t("trackerExtra.reopen") : t("trackerExtra.resolved")}
            </button>
          )}
          {suggestion.canChangeVisibility && (
            <button
              className={contributionsStyles["suggestion-visibility-action"]}
              type="button"
              onClick={() => onToggleVisibility(suggestion)}
              disabled={busy}
            >
              <ActionIcon name={suggestion.hidden ? "eye" : "eye-off"} />
              {suggestion.hidden ? t("trackerExtra.show") : t("trackerExtra.hide")}
            </button>
          )}
          {suggestion.canDelete && (
            <div
              className={contributionsStyles["suggestion-more"]}
              ref={menuRef}
            >
              <button
                type="button"
                className={contributionsStyles["suggestion-more-trigger"]}
                aria-label={t("trackerExtra.moreActionsFor", { kind: contributionLabel, name: suggestion.author.name })}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title={t("trackerExtra.moreActions")}
                onClick={() => setMenuOpen((current) => !current)}
                disabled={busy}
                ref={menuButtonRef}
              >
                <ActionIcon name="more" />
              </button>
              {menuOpen && (
                <div
                  className={contributionsStyles["suggestion-more-menu"]}
                  role="menu"
                >
                  <button
                    type="button"
                    className="danger"
                    role="menuitem"
                    onClick={() => onDelete(suggestion)}
                  >
                    {t("trackerExtra.delete")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {busy && !action.error && (
        <p
          className={contributionsStyles["suggestion-action-state"]}
          role="status"
        >
          {t("trackerExtra.updating")}
        </p>
      )}
      {action.id === suggestion.id && action.error && (
        <p
          className={contributionsStyles["suggestion-action-error"]}
          role="alert"
        >
          {t("trackerExtra.retry", { error: action.error })}
        </p>
      )}
    </article>
  );
}

function SuggestionComposer({ target, error, onClose, onSubmit }) {
  const { t } = useLocale();
  const [kind, setKind] = useState("suggestion");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);

  return (
    <Dialog
      onClose={onClose}
      initialFocusRef={bodyRef}
      overlayClassName={contributionsStyles["suggestion-overlay"]}
    >
      <form
        className={contributionsStyles["suggestion-composer"]}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await onSubmit({ kind, body });
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className={contributionsStyles["suggestion-composer-head"]}>
          <DialogTitle asChild>
            <h2>{t("trackerExtra.composerTitle", { target })}</h2>
          </DialogTitle>
          <button type="button" onClick={onClose} aria-label={t("trackerExtra.close")}>
            <ActionIcon name="close" />
          </button>
        </div>
        <label>
          {t("trackerExtra.kind")}
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="suggestion">{t("trackerExtra.suggestChange")}</option>
            <option value="comment">{t("trackerExtra.commentNote")}</option>
          </select>
        </label>
        <label>
          {t("trackerExtra.body")}
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            minLength="2"
            maxLength="2000"
            rows="5"
            ref={bodyRef}
            required
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className={contributionsStyles["suggestion-composer-actions"]}>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("trackerExtra.cancel")}
          </Button>
          <Button variant="primary" disabled={busy}>
            {busy ? t("trackerExtra.sending") : t("trackerExtra.send")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const statusLabel = (status, t) =>
  ({ accepted: t("trackerExtra.accepted"), resolved: t("trackerExtra.resolved"), rejected: t("trackerExtra.rejected") })[
    status
  ] || t("trackerExtra.new");
