"use client";
import adminShellStyles from "../src/styles/admin-shell.module.css";
import scheduleEditorStyles from "../src/styles/schedule-editor.module.css";
import tripRequestsStyles from "../src/styles/trip-requests.module.css";

import Footer from "./ui/Footer";
import Button from "./ui/Button";

import { requestJson } from "../lib/request-json.mjs";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import NotificationCenter from "./NotificationCenter";
import LanguageSwitcher from "./LanguageSwitcher";
import TripRequestDetails, {
  formatRequestRange,
} from "./TripRequestDetails";
import ViewerMenu from "./ViewerMenu";
import { useLocale } from "./LocaleProvider";
import { invitationErrorText } from "../lib/i18n-invitations.mjs";

const emptyRequest = {
  startDate: "",
  endDate: "",
  places: [""],
  sources: [],
  notes: "",
};

export default function TripRequestApp({ viewer, initialRequests }) {
  if (!viewer) return <RequestLogin />;
  return <RequestWorkspace viewer={viewer} initialRequests={initialRequests} />;
}

function RequestLogin() {
  const { t } = useLocale();
  return (
    <main
      className={`${adminShellStyles["admin-shell"]} ${scheduleEditorStyles["admin-login-shell"]} request-login-shell`}
    >
      <section className={scheduleEditorStyles["admin-login-card"]}>
        <LanguageSwitcher />
        <Link href="/" className={adminShellStyles["admin-back"]}>
          {t("common.backToTrip")}
        </Link>
        <h1>{t("requests.title")}</h1>
        <p>{t("requests.loginDescription")}</p>
        <Button
          variant="primary"
          type="button"
          onClick={() => signIn("google", { redirectTo: "/requests" })}
        >
          {t("common.loginContinue")}
        </Button>
      </section>
    </main>
  );
}

function RequestWorkspace({ viewer, initialRequests }) {
  const { t, intlLocale, locale } = useLocale();
  const api = (path, options) =>
    requestJson(path, options, "invitationsExtra.updateRequestError");
  const [requests, setRequests] = useState(initialRequests);
  const [selectedId, setSelectedId] = useState(initialRequests[0]?.id || null);
  const [editor, setEditor] = useState(
    initialRequests.length
      ? null
      : { mode: "new", initial: emptyRequest, values: emptyRequest },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected =
    requests.find((request) => request.id === selectedId) ||
    requests[0] ||
    null;
  const editorDirty =
    editor && JSON.stringify(editor.initial) !== JSON.stringify(editor.values);

  useEffect(() => {
    if (!editorDirty) return undefined;
    const protectDraft = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [editorDirty]);

  const leaveEditor = () =>
    !editorDirty ||
    window.confirm(t("invitationsExtra.discardRequest"));
  const chooseRequest = (request) => {
    if (!leaveEditor()) return;
    setSelectedId(request.id);
    setEditor(null);
    setError("");
  };
  const startNew = () => {
    if (!leaveEditor()) return;
    const values = { ...emptyRequest, places: [""], sources: [] };
    setEditor({ mode: "new", initial: values, values });
    setSelectedId(null);
    setError("");
  };
  const startEdit = () => {
    if (!selected || selected.state !== "open") return;
    const values = {
      startDate: selected.startDate,
      endDate: selected.endDate,
      places: [...selected.places],
      sources: selected.sources.map((source) => ({ ...source })),
      notes: selected.notes,
    };
    setEditor({
      mode: "edit",
      requestId: selected.id,
      initial: values,
      values,
    });
  };
  const replaceRequest = (updated) => {
    setRequests((current) =>
      current.some((item) => item.id === updated.id)
        ? current.map((item) => (item.id === updated.id ? updated : item))
        : [updated, ...current],
    );
    setSelectedId(updated.id);
  };

  const saveRequest = async (values) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated =
        editor.mode === "new"
          ? await api("/api/trip-requests", {
              method: "POST",
              body: JSON.stringify(values),
            })
          : await api(`/api/trip-requests/${editor.requestId}`, {
              method: "PATCH",
              body: JSON.stringify({ action: "update", request: values }),
            });
      replaceRequest(updated);
      setEditor(null);
      setNotice(
        editor.mode === "new"
          ? "invitationsExtra.tripRequestSent"
          : "invitationsExtra.tripRequestSaved",
      );
    } catch (saveError) {
      setError({ message: saveError.message, suffix: "invitationsExtra.checkFields" });
    } finally {
      setBusy(false);
    }
  };

  const changeState = async (request, action) => {
    const question =
      action === "withdraw"
        ? t("invitationsExtra.withdrawConfirm")
        : null;
    if (question && !window.confirm(question)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await api(`/api/trip-requests/${request.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      replaceRequest(updated);
      setNotice(
        action === "withdraw"
          ? "invitationsExtra.withdrawnNotice"
          : "invitationsExtra.restoredNotice",
      );
    } catch (stateError) {
      setError({ message: stateError.message, suffix: "invitationsExtra.retryError" });
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(
    () => ({
      open: requests.filter((request) => request.state === "open").length,
      fulfilled: requests.filter((request) => request.state === "fulfilled")
        .length,
    }),
    [requests],
  );

  return (
    <main className={tripRequestsStyles["request-shell"]}>
      <header className={tripRequestsStyles["request-header"]}>
        <div>
          <Link href="/" className={adminShellStyles["admin-back"]}>
            {t("common.backToTrip")}
          </Link>
          <h1>{t("requests.title")}</h1>
          <p>{t("requests.description")}</p>
        </div>
        <div className={tripRequestsStyles["request-header-tools"]}>
          <LanguageSwitcher />
          <NotificationCenter />
          <ViewerMenu viewer={viewer} />
        </div>
      </header>
      <div
        className={tripRequestsStyles["request-status-band"]}
        aria-label={t("requests.summary")}
      >
        <span>
          <strong>{counts.open}</strong> {t("requests.open")}
        </span>
        <span>
          <strong>{counts.fulfilled}</strong> {t("requests.fulfilled")}
        </span>
        <span>
          <strong>{requests.length}</strong>{t("invitationsExtra.totalRequests")}
        </span>
      </div>
      {error && (
        <p className={adminShellStyles["admin-alert"]} role="alert">
          {t(error.suffix, { error: invitationErrorText(t, locale, error, "invitationsExtra.updateRequestError") })}
        </p>
      )}
      {notice && (
        <p className={adminShellStyles["admin-notice"]} role="status">
          {t(notice)}
        </p>
      )}

      <div className={tripRequestsStyles["request-workspace"]}>
        <aside className={tripRequestsStyles["request-rail"]}>
          <div className={adminShellStyles["admin-section-head"]}>
          <h2>{t("nav.myRequests")}</h2>
            <Button
              variant="primary"
              className="small"
              type="button"
              onClick={startNew}
            >
              {t("requests.new")}
            </Button>
          </div>
          <div className={tripRequestsStyles["request-rail-list"]}>
            {requests.map((request) => (
              <button
                className={`${tripRequestsStyles["request-rail-item"]} is-${request.state}${selected?.id === request.id && !editor ? " is-active" : ""}`}
                type="button"
                onClick={() => chooseRequest(request)}
                key={request.id}
              >
                <span
                  className={tripRequestsStyles["request-rail-node"]}
                  aria-hidden="true"
                />
                <b>{request.places[0]}</b>
                <small>{formatRequestRange(request, intlLocale)}</small>
                <em>{t(`requests.status.${request.state}`)}</em>
              </button>
            ))}
            {!requests.length && (
              <p className={tripRequestsStyles["request-empty-rail"]}>
                {t("requests.empty")}
              </p>
            )}
          </div>
        </aside>

        <section
          className={tripRequestsStyles["request-stage"]}
          aria-live="polite"
        >
          {editor ? (
            <TripRequestForm
              editor={editor}
              busy={busy}
              onChange={(values) =>
                setEditor((current) => ({ ...current, values }))
              }
              onSave={saveRequest}
              onCancel={() => {
                if (leaveEditor()) {
                  setEditor(null);
                  setSelectedId(requests[0]?.id || null);
                }
              }}
            />
          ) : selected ? (
            <article
              className={`${tripRequestsStyles["request-ticket"]} is-${selected.state}`}
            >
              <header className={tripRequestsStyles["request-ticket-head"]}>
                <div>
                  <span>{t(`requests.status.${selected.state}`)}</span>
                  <h2>{selected.places.join(" · ")}</h2>
                </div>
                <div className={tripRequestsStyles["request-ticket-actions"]}>
                  {selected.state === "open" && (
                    <>
                      <Button variant="ghost" type="button" onClick={startEdit}>
                        {t("common.edit")}
                      </Button>
                      <Button
                        variant="danger"
                        type="button"
                        disabled={busy}
                        onClick={() => changeState(selected, "withdraw")}
                      >
                        {t("requests.withdraw")}
                      </Button>
                    </>
                  )}
                  {selected.state === "withdrawn" && (
                    <Button
                      variant="primary"
                      type="button"
                      disabled={busy}
                      onClick={() => changeState(selected, "restore")}
                    >
                      {t("requests.restore")}
                    </Button>
                  )}
                </div>
              </header>
              <TripRequestDetails request={selected} />
            </article>
          ) : (
            <div className={tripRequestsStyles["request-stage-empty"]}>
              <h2>{t("requests.chooseRequest")}</h2>
              <p>{t("requests.chooseRequestDescription")}</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function TripRequestForm({ editor, busy, onChange, onSave, onCancel }) {
  const { t } = useLocale();
  const values = editor.values;
  const set = (key, value) => onChange({ ...values, [key]: value });
  const updatePlace = (index, value) =>
    set(
      "places",
      values.places.map((place, placeIndex) =>
        placeIndex === index ? value : place,
      ),
    );
  const updateSource = (index, key, value) =>
    set(
      "sources",
      values.sources.map((source, sourceIndex) =>
        sourceIndex === index ? { ...source, [key]: value } : source,
      ),
    );
  return (
    <form
      className={tripRequestsStyles["request-editor"]}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(values);
      }}
    >
      <header>
        <div>
          <span>
            {editor.mode === "new" ? t("requests.new") : t("requests.editing")}
          </span>
          <h2>{t("requests.whereToGo")}</h2>
        </div>
        <Button variant="ghost" type="button" onClick={onCancel}>
          {t("common.close")}
        </Button>
      </header>
      <div className={tripRequestsStyles["request-date-fields"]}>
        <label>
          {t("requests.fields.startDate")}
          <input
            type="date"
            required
            value={values.startDate}
            onChange={(event) => set("startDate", event.target.value)}
          />
        </label>
        <label>
          {t("requests.fields.endDate")}
          <input
            type="date"
            required
            min={values.startDate || undefined}
            value={values.endDate}
            onChange={(event) => set("endDate", event.target.value)}
          />
        </label>
      </div>
      <fieldset className={tripRequestsStyles["request-repeatable"]}>
        <legend>{t("requests.fields.places")}</legend>
        <p>{t("requests.placesHelp")}</p>
        {values.places.map((place, index) => (
          <div
            className={tripRequestsStyles["request-place-field"]}
            key={index}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <label>
              <span className="sr-only">{t("requests.placeNumber", { number: index + 1 })}</span>
              <input
                required
                maxLength={160}
                value={place}
                placeholder={
                  index === 0 ? t("requests.examplePlace") : t("requests.nextPlace")
                }
                onChange={(event) => updatePlace(index, event.target.value)}
              />
            </label>
            {values.places.length > 1 && (
              <Button
                variant="danger"
                type="button"
                aria-label={t("requests.removePlace", { number: index + 1 })}
                onClick={() =>
                  set(
                    "places",
                    values.places.filter(
                      (_, placeIndex) => placeIndex !== index,
                    ),
                  )
                }
              >
                {t("common.delete")}
              </Button>
            )}
          </div>
        ))}
        {values.places.length < 12 && (
          <Button
            variant="ghost"
            className={tripRequestsStyles["request-add-row"]}
            type="button"
            onClick={() => set("places", [...values.places, ""])}
          >
            {t("requests.addPlace")}
          </Button>
        )}
      </fieldset>
      <fieldset className={tripRequestsStyles["request-repeatable"]}>
        <legend>{t("requests.referenceSources")}</legend>
        <p>{t("requests.sourcesHelp")}</p>
        {values.sources.map((source, index) => (
          <div
            className={tripRequestsStyles["request-source-field"]}
            key={index}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <label>
              {t("requests.sourceLabel")}
              <input
                maxLength={300}
                value={source.label || ""}
                placeholder={t("requests.sourceLabelPlaceholder")}
                onChange={(event) =>
                  updateSource(index, "label", event.target.value)
                }
              />
            </label>
            <label>{t("invitationsExtra.url")}
              <input
                type="url"
                required
                value={source.url}
                placeholder="https://…"
                onChange={(event) =>
                  updateSource(index, "url", event.target.value)
                }
              />
            </label>
            <Button
              variant="danger"
              type="button"
              aria-label={t("requests.removeSource", { number: index + 1 })}
              onClick={() =>
                set(
                  "sources",
                  values.sources.filter(
                    (_, sourceIndex) => sourceIndex !== index,
                  ),
                )
              }
            >
              {t("common.delete")}
            </Button>
          </div>
        ))}
        {values.sources.length < 10 && (
          <Button
            variant="ghost"
            className={tripRequestsStyles["request-add-row"]}
            type="button"
            onClick={() =>
              set("sources", [...values.sources, { label: "", url: "" }])
            }
          >
            {t("requests.addSource")}
          </Button>
        )}
      </fieldset>
      <label className={tripRequestsStyles["request-notes-field"]}>
        {t("requests.fields.notes")}
        <textarea
          rows={5}
          maxLength={2000}
          value={values.notes}
          placeholder={t("requests.notesPlaceholder")}
          onChange={(event) => set("notes", event.target.value)}
        />
        <span>{values.notes.length}/2000</span>
      </label>
      <Footer>
        <Button variant="ghost" type="button" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" disabled={busy}>
          {busy
            ? t("common.saving")
            : editor.mode === "new"
              ? t("requests.send")
              : t("common.save")}
        </Button>
      </Footer>
    </form>
  );
}
