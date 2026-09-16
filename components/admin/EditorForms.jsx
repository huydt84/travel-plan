import { useLocale } from "../LocaleProvider";
import { adminErrorMessage } from "../../lib/i18n-admin.mjs";
import scheduleEditorStyles from "../../src/styles/schedule-editor.module.css";
import adminShellStyles from "../../src/styles/admin-shell.module.css";

import Button from "../ui/Button";
import { useId, useRef, useState } from "react";
import { calendarDayDifference } from "../../lib/trip-dates.mjs";
import { normalizeScheduleRefs } from "../../lib/schedule-editor-state.mjs";
import { ActionIcon } from "../Icons";
import { requestJson as api } from "../../lib/request-json.mjs";

const emptySource = { title: "", url: "" };
const emptyPlace = { name: "", address: "", latitude: "", longitude: "", website: "", googlePlaceId: "", notes: "" };
const openTimePicker = (event) => {
  try {
    event.currentTarget.showPicker?.();
  } catch {
    // Browsers without a programmable native picker still keep the normal time input behavior.
  }
};

export function TripForm({ editor, busy, onSave, onCancel }) {
  const { t } = useLocale();
  const [values, setValues] = useState({
    ...editor.values,
    moveSchedule: Boolean(editor.originalSlug),
  });
  const [memberRows, setMemberRows] = useState(() => editor.originalSlug ? [] : (editor.values.memberEmails?.length ? editor.values.memberEmails : [""]));
  const [memberErrors, setMemberErrors] = useState({});
  const field = (name) => ({
    value: values[name] || "",
    onChange: (event) => setValues({ ...values, [name]: event.target.value }),
  });
  const datesChanged = Boolean(
    editor.originalSlug &&
      (values.startDate !== editor.values.startDate ||
        values.endDate !== editor.values.endDate),
  );
  const canMoveSchedule =
    datesChanged &&
    values.startDate &&
    values.endDate &&
    calendarDayDifference(editor.values.startDate, editor.values.endDate) ===
      calendarDayDifference(values.startDate, values.endDate);
  const changeStartDate = (event) => {
    const startDate = event.target.value;
    const endDate =
      !values.endDate || values.endDate === values.startDate
        ? startDate
        : values.endDate;
    setValues({ ...values, startDate, endDate });
  };
  return (
    <form
      className={`${scheduleEditorStyles["admin-editor"]} ${scheduleEditorStyles["admin-form"]}`}
      onSubmit={async (event) => {
        event.preventDefault();
        const normalized = memberRows.map((email) => email.trim().toLowerCase()).filter(Boolean);
        if (!editor.originalSlug && normalized.length) {
          const results = await Promise.all(normalized.map(async (email) => {
            try { await api("/api/users/lookup", { method: "POST", body: JSON.stringify({ email }) }); return [email, ""]; }
            catch { return [email, t("visibility.unregisteredEmail")]; }
          }));
          const errors = Object.fromEntries(results.filter(([, message]) => message));
          setMemberErrors(errors);
          if (Object.keys(errors).length) return;
        }
        onSave(
          { ...values, memberEmails: [...new Set(normalized)], moveSchedule: canMoveSchedule && values.moveSchedule },
          editor.originalSlug,
        );
      }}
    >
      <div className={adminShellStyles["admin-section-head"]}>
        <h2>
          {editor.originalSlug
            ? t("adminExtra.message032")
            : t("adminExtra.message194")}
        </h2>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("adminExtra.message165")}
        </Button>
      </div>
      {!editor.originalSlug && (
        <fieldset className={scheduleEditorStyles["member-email-editor"]}>
          <legend>{t("visibility.addMembersOnCreate")}</legend>
          <p>{t("visibility.registeredOnlyHelp")}</p>
          {memberRows.map((email, index) => <div key={index} className={scheduleEditorStyles["member-email-row"]}>
            <label><span>{t("visibility.memberEmail", { number: index + 1 })}</span>
              <input type="email" value={email} placeholder="friend@example.com" aria-invalid={Boolean(memberErrors[email.trim().toLowerCase()])}
                onChange={(event) => {
                  const next = [...memberRows]; next[index] = event.target.value; setMemberRows(next);
                  setMemberErrors((current) => { const copy = { ...current }; delete copy[email.trim().toLowerCase()]; return copy; });
                }} />
              {memberErrors[email.trim().toLowerCase()] && <small role="alert">{memberErrors[email.trim().toLowerCase()]}</small>}
            </label>
            {memberRows.length > 1 && <button type="button" onClick={() => setMemberRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} aria-label={t("visibility.removeEmail", { number: index + 1 })}><ActionIcon name="close" /></button>}
          </div>)}
          <Button type="button" variant="ghost" onClick={() => setMemberRows((current) => [...current, ""])}>{t("visibility.addAnotherEmail")}</Button>
        </fieldset>
      )}
      <div className={scheduleEditorStyles["form-grid"]}>
        <label>
          {t("adminExtra.message166")}{" "}
          <input {...field("slug")} placeholder="tokyo-2026-08-10" required />
        </label>
        <label>
          {t("adminExtra.message167")} <input {...field("title")} required />
        </label>
        <label>
          {t("adminExtra.message168")}{" "}
          <input
            type="date"
            value={values.startDate || ""}
            onChange={changeStartDate}
            required
          />
        </label>
        <label>
          {t("adminExtra.message169")}{" "}
          <input
            type="date"
            {...field("endDate")}
            min={values.startDate || undefined}
            required
          />
        </label>
        <label>
          {t("adminExtra.message170")} <input {...field("timezone")} required />
        </label>
        <label className="wide">
          {t("adminExtra.message171")} <input {...field("location")} required />
        </label>
      </div>
      {canMoveSchedule && (
        <label className={scheduleEditorStyles["trip-shift-option"]}>
          <input
            type="checkbox"
            checked={values.moveSchedule}
            onChange={(event) =>
              setValues({ ...values, moveSchedule: event.target.checked })
            }
          />
          <span>
            <strong>{t("adminExtra.message195")}</strong>
            <small> {t("adminExtra.message196")} </small>
          </span>
        </label>
      )}
      {datesChanged && !canMoveSchedule && (
        <p className={scheduleEditorStyles["form-guidance"]}>
          {t("adminExtra.message197")}
        </p>
      )}
      <Button variant="primary" disabled={busy}>
        {busy ? t("adminExtra.message198") : t("adminExtra.message199")}
      </Button>
    </form>
  );
}

export function ScheduleForm({
  editor,
  busy,
  error,
  sources,
  placement,
  onChange,
  onCreateSource,
  onSave,
  onCancel,
}) {
  const { t } = useLocale();
  const ACTIVITY_TYPES = [
    { value: "Transit", label: t("adminExtra.message175"), icon: "🚆" },
    { value: "Walk", label: t("adminExtra.message176"), icon: "🚶" },
    { value: "Visit", label: t("adminExtra.message234"), icon: "📍" },
    { value: "Film", label: t("adminExtra.message177"), icon: "🎬📷" },
    { value: "Buffer", label: t("adminExtra.message178"), icon: "🧊" },
    { value: "Rest", label: t("adminExtra.message179"), icon: "☕" },
    { value: "Cafe", label: t("adminExtra.message180"), icon: "☕" },
    { value: "Lunch", label: t("adminExtra.message181"), icon: "🍜" },
    { value: "Dinner", label: t("adminExtra.message182"), icon: "🍽️" },
    { value: "Picnic", label: t("adminExtra.message183"), icon: "🧺" },
    { value: "Indoor", label: t("adminExtra.message184"), icon: "🏠" },
  ];
  const ACTIVITY_ICONS = [
    { value: "🚆", label: t("adminExtra.message185") },
    { value: "🚃", label: t("adminExtra.message186") },
    { value: "🚶", label: t("adminExtra.message176") },
    { value: "📍", label: t("adminExtra.message171") },
    { value: "🎬📷", label: t("adminExtra.message177") },
    { value: "🧊", label: t("adminExtra.message178") },
    { value: "☕", label: t("adminExtra.message187") },
    { value: "🍜", label: t("adminExtra.message188") },
    { value: "🍽️", label: t("adminExtra.message189") },
    { value: "🧺", label: t("adminExtra.message190") },
    { value: "🏠", label: t("adminExtra.message184") },
    { value: "⛩️", label: t("adminExtra.message191") },
    { value: "🏛️", label: t("adminExtra.message192") },
  ];

  const includeCurrentOption = (options, value, label = value) =>
    value && !options.some((option) => option.value === value)
      ? [
          { value, label: t("adminExtra.message193", { value0: label }) },
          ...options,
        ]
      : options;

  const values = editor.values;
  const field = (name) => ({
    value: values[name] ?? "",
    onChange: (event) => onChange({ ...values, [name]: event.target.value }),
  });
  const typeOptions = includeCurrentOption(ACTIVITY_TYPES, values.type);
  const iconOptions = includeCurrentOption(
    ACTIVITY_ICONS,
    values.icon,
    values.icon,
  );
  const changeType = (event) => {
    const nextType = event.target.value;
    const currentDefaultIcon = ACTIVITY_TYPES.find(
      (option) => option.value === values.type,
    )?.icon;
    const nextDefaultIcon = ACTIVITY_TYPES.find(
      (option) => option.value === nextType,
    )?.icon;
    onChange({
      ...values,
      type: nextType,
      icon:
        !values.icon || values.icon === currentDefaultIcon
          ? nextDefaultIcon
          : values.icon,
    });
  };
  return (
    <form
      id={`schedule-editor-${editor.key}`}
      className={`${scheduleEditorStyles["admin-editor"]} ${scheduleEditorStyles["admin-form"]} ${scheduleEditorStyles["schedule-editor"]} ${placement === "inline" ? scheduleEditorStyles["schedule-inline-editor"] : scheduleEditorStyles["schedule-create-editor"]}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(values, values.id);
      }}
    >
      <div
        className={`${adminShellStyles["admin-section-head"]} ${scheduleEditorStyles["schedule-editor-head"]}`}
      >
        <h2 tabIndex="-1" data-editor-heading>
          {values.id
            ? t("adminExtra.message200", {
                value0: values.title || t("adminExtra.message201"),
              })
            : t("adminExtra.message202")}
        </h2>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          {t("adminExtra.message082")}
        </Button>
      </div>
      <div
        className={`${scheduleEditorStyles["form-grid"]} ${scheduleEditorStyles["schedule-form-grid"]}`}
      >
        <label
          className={`${scheduleEditorStyles["schedule-field"]} ${scheduleEditorStyles["schedule-date-field"]}`}
        >
          {t("adminExtra.message168")}{" "}
          <input type="date" {...field("startDate")} required />
        </label>
        <label
          className={`${scheduleEditorStyles["schedule-field"]} ${scheduleEditorStyles["schedule-time-field"]}`}
        >
          {t("adminExtra.message203")}{" "}
          <input
            type="time"
            {...field("start")}
            onClick={openTimePicker}
            required
          />
        </label>
        <label
          className={`${scheduleEditorStyles["schedule-field"]} ${scheduleEditorStyles["schedule-date-field"]}`}
        >
          {t("adminExtra.message169")}{" "}
          <input
            type="date"
            {...field("endDate")}
            min={values.startDate || undefined}
            required
          />
        </label>
        <label
          className={`${scheduleEditorStyles["schedule-field"]} ${scheduleEditorStyles["schedule-time-field"]}`}
        >
          {t("adminExtra.message204")}{" "}
          <input
            type="time"
            {...field("end")}
            onClick={openTimePicker}
            required
          />
        </label>
        <label
          className={`${scheduleEditorStyles["schedule-field"]} ${scheduleEditorStyles["schedule-display-field"]}`}
        >
          {t("adminExtra.message205")}{" "}
          <input
            {...field("displayEnd")}
            placeholder={t("adminExtra.message206")}
          />
        </label>
        <label
          className={`${scheduleEditorStyles["schedule-field"]} ${scheduleEditorStyles["schedule-type-field"]}`}
        >
          {t("adminExtra.message207")}{" "}
          <select value={values.type || ""} onChange={changeType} required>
            {typeOptions.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label
          className={`${scheduleEditorStyles["schedule-field"]} ${scheduleEditorStyles["schedule-icon-field"]}`}
        >
          {t("adminExtra.message208")}{" "}
          <select {...field("icon")} required>
            {iconOptions.map((option) => (
              <option value={option.value} key={option.value}>
                {option.value} · {option.label}
              </option>
            ))}
          </select>
        </label>
        <label
          className={`wide ${scheduleEditorStyles["schedule-field"]} schedule-title-field`}
        >
          {t("adminExtra.message209")} <input {...field("title")} required />
        </label>
        <label
          className={`wide ${scheduleEditorStyles["schedule-field"]} schedule-detail-field`}
        >
          <span>
            {t("adminExtra.message210")}{" "}
            <small className={scheduleEditorStyles["field-optional"]}>
              {t("adminExtra.message160")}
            </small>
          </span>
          <textarea {...field("detail")} rows="3" />
        </label>
      </div>
      {values.startDate &&
        values.endDate &&
        values.endDate !== values.startDate && (
          <p className={scheduleEditorStyles["overnight-note"]}>
            <ActionIcon name="moon" /> {t("adminExtra.message211")}
          </p>
        )}
      <SourcePicker
        sources={sources}
        selectedRefs={values.refs}
        onChange={(refs) => onChange({ ...values, refs })}
        onCreateSource={onCreateSource}
      />
      {error && (
        <p
          className={`form-error ${scheduleEditorStyles["schedule-form-error"]}`}
          role="alert"
        >
          {error}
        </p>
      )}
      <div className={scheduleEditorStyles["schedule-editor-actions"]}>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          {t("adminExtra.message082")}
        </Button>
        <Button variant="primary" disabled={busy}>
          {busy
            ? t("adminExtra.message198")
            : values.id
              ? t("adminExtra.message212")
              : t("adminExtra.message042")}
        </Button>
      </div>
    </form>
  );
}

function SourcePicker({ sources, selectedRefs, onChange, onCreateSource }) {
  const { t } = useLocale();
  const [addingSource, setAddingSource] = useState(false);
  const [creatingSource, setCreatingSource] = useState(false);
  const [createdNotice, setCreatedNotice] = useState("");
  const refs = normalizeScheduleRefs(selectedRefs);
  const toggleSource = (number) => {
    const next = refs.includes(number)
      ? refs.filter((ref) => ref !== number)
      : [...refs, number];
    onChange(normalizeScheduleRefs(next));
  };
  const createAndSelectSource = async (values) => {
    setCreatingSource(true);
    try {
      const source = await onCreateSource(values);
      onChange(normalizeScheduleRefs([...refs, source.number]));
      setAddingSource(false);
      setCreatedNotice(t("adminExtra.message213", { value0: source.title }));
      return source;
    } finally {
      setCreatingSource(false);
    }
  };
  return (
    <fieldset className={scheduleEditorStyles["source-picker"]}>
      <legend>{t("adminExtra.message214")}</legend>
      <div className={scheduleEditorStyles["source-picker-frame"]}>
        <div className={scheduleEditorStyles["source-picker-head"]}>
          <p>
            {sources.length
              ? t("adminExtra.message215")
              : t("adminExtra.message216")}
          </p>
          {!addingSource && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAddingSource(true);
                setCreatedNotice("");
              }}
            >
              {sources.length
                ? t("adminExtra.message217")
                : t("adminExtra.message218")}
            </Button>
          )}
        </div>
        {sources.length > 0 && (
          <div className={scheduleEditorStyles["source-picker-list"]}>
            {sources.map((source) => (
              <label
                className={scheduleEditorStyles["source-option"]}
                key={source.number}
              >
                <input
                  type="checkbox"
                  checked={refs.includes(source.number)}
                  onChange={() => toggleSource(source.number)}
                  disabled={creatingSource}
                />
                <span className={scheduleEditorStyles["source-option-number"]}>
                  {String(source.number).padStart(2, "0")}
                </span>
                <span className={scheduleEditorStyles["source-option-copy"]}>
                  <strong>{source.title}</strong>
                  <small>{source.host}</small>
                </span>
              </label>
            ))}
          </div>
        )}
        {addingSource && (
          <SourceForm
            compact
            onSave={createAndSelectSource}
            onCancel={() => setAddingSource(false)}
          />
        )}
        {createdNotice && (
          <p
            className={scheduleEditorStyles["source-created-notice"]}
            role="status"
          >
            {createdNotice}
          </p>
        )}
      </div>
    </fieldset>
  );
}

export function SourceForm({
  compact = false,
  source = null,
  onSave,
  onCancel,
}) {
  const { t, locale } = useLocale();
  const [values, setValues] = useState(
    source ? { title: source.title, url: source.url } : emptySource,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fieldsRef = useRef(null);
  const hintId = useId();
  const field = (name) => ({
    value: values[name],
    onChange: (event) => setValues({ ...values, [name]: event.target.value }),
  });
  const submitSource = async (event) => {
    event?.preventDefault?.();
    if (compact) {
      if (!values.title.trim()) {
        setError(t("adminExtra.message219"));
        fieldsRef.current?.querySelector("input")?.focus();
        return;
      }
      try {
        const parsed = new URL(values.url);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch {
        setError(t("adminExtra.message220"));
        fieldsRef.current?.querySelectorAll("input")?.[1]?.focus();
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      await onSave(values);
    } catch (requestError) {
      setError(adminErrorMessage(requestError, t, locale));
    } finally {
      setBusy(false);
    }
  };
  const fields = (
    <div
      className={
        compact
          ? scheduleEditorStyles["source-inline-fields"]
          : scheduleEditorStyles["form-grid"]
      }
      ref={fieldsRef}
    >
      <label className={compact ? "" : "wide"}>
        {t("adminExtra.message221")}{" "}
        <input
          {...field("title")}
          maxLength={300}
          placeholder={t("adminExtra.message222")}
          required={!compact}
        />
      </label>
      <label className={compact ? "" : "wide"}>
        {t("adminExtra.message223")}{" "}
        <input
          type={compact ? "text" : "url"}
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          {...field("url")}
          maxLength={2000}
          placeholder="https://example.com/dia-diem"
          aria-describedby={hintId}
          required={!compact}
        />
        <small id={hintId}>{t("adminExtra.message224")}</small>
      </label>
    </div>
  );
  if (compact) {
    return (
      <section
        className={scheduleEditorStyles["source-inline-form"]}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target.tagName === "INPUT")
            submitSource(event);
        }}
      >
        <div className={scheduleEditorStyles["source-inline-head"]}>
          <strong>{t("adminExtra.message217")}</strong>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("adminExtra.message082")}
          </Button>
        </div>
        {fields}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          type="button"
          variant="primary"
          onClick={submitSource}
          disabled={busy}
        >
          {busy ? t("adminExtra.message225") : t("adminExtra.message226")}
        </Button>
      </section>
    );
  }
  return (
    <form
      className={`${scheduleEditorStyles["admin-editor"]} ${scheduleEditorStyles["admin-form"]} ${scheduleEditorStyles["source-form"]}`}
      onSubmit={submitSource}
    >
      <div className={adminShellStyles["admin-section-head"]}>
        <h2>
          {source
            ? t("adminExtra.message227", { value0: source.number })
            : t("adminExtra.message228")}
        </h2>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("adminExtra.message082")}
        </Button>
      </div>
      {fields}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Button variant="primary" disabled={busy}>
        {busy
          ? t("adminExtra.message198")
          : source
            ? t("adminExtra.message229")
            : t("adminExtra.message036")}
      </Button>
    </form>
  );
}

export function PlaceForm({ place = null, onSave, onCancel }) {
  const { t, locale } = useLocale();
  const [values, setValues] = useState(place ? {
    name: place.name,
    address: place.address,
    latitude: place.latitude ?? "",
    longitude: place.longitude ?? "",
    website: place.website || "",
    googlePlaceId: place.googlePlaceId || "",
    notes: place.notes || "",
  } : emptyPlace);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = (name) => ({
    value: values[name],
    onChange: (event) => setValues({ ...values, [name]: event.target.value }),
  });
  const label = place ? t("adminPlaces.editForm", { name: place.name }) : t("adminPlaces.add");
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try { await onSave(values); }
    catch (requestError) { setError(adminErrorMessage(requestError, t, locale)); }
    finally { setBusy(false); }
  };
  return <form aria-label={label} className={`${scheduleEditorStyles["admin-editor"]} ${scheduleEditorStyles["admin-form"]} ${scheduleEditorStyles["place-form"]}`} onSubmit={submit}>
    <div className={adminShellStyles["admin-section-head"]}>
      <h2>{label}</h2>
      <Button type="button" variant="ghost" onClick={onCancel}>{t("adminPlaces.cancel")}</Button>
    </div>
    <div className={scheduleEditorStyles["form-grid"]}>
      <label>{t("adminPlaces.name")} <input {...field("name")} maxLength={240} required /></label>
      <label>{t("adminPlaces.address")} <input {...field("address")} maxLength={1000} required /></label>
      <label>{t("adminPlaces.latitude")} <input {...field("latitude")} type="number" inputMode="decimal" min="-90" max="90" step="any" /></label>
      <label>{t("adminPlaces.longitude")} <input {...field("longitude")} type="number" inputMode="decimal" min="-180" max="180" step="any" /></label>
      <label className="wide">{t("adminPlaces.website")} <input {...field("website")} type="url" inputMode="url" maxLength={2000} /></label>
      <label className="wide">{t("adminPlaces.googlePlaceId")} <input {...field("googlePlaceId")} maxLength={500} /></label>
      <label className="wide">{t("adminPlaces.notes")} <textarea {...field("notes")} rows={3} maxLength={2000} /></label>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <Button variant="primary" disabled={busy}>{busy ? t("adminPlaces.saving") : place ? t("adminPlaces.save") : t("adminPlaces.add")}</Button>
  </form>;
}
