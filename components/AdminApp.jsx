"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { ADMIN_ROUTES } from "../lib/admin-routes.mjs";
import { createScheduleEditor, normalizeScheduleRefs, scheduleEditorIsDirty } from "../lib/schedule-editor-state.mjs";
import { ActionIcon, TypeIcon } from "./Icons";
import AdminNav from "./AdminNav";

const emptyTrip = { slug: "", title: "", date: "", timezone: "Asia/Tokyo", location: "" };
const emptySchedule = { start: "", end: "", displayEnd: "", type: "Visit", icon: "📍", title: "", detail: "", refs: [] };
const emptySource = { title: "", url: "" };

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...options.headers } : options.headers,
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
};

export default function AdminApp({ viewer, initialTrips, initialSelectedSlug, initialPlan, initialSuggestions }) {
  if (!viewer?.email) return <Login />;
  if (!viewer.isOwner) return <ContributorOnly user={viewer} />;
  return (
    <Dashboard
      user={viewer}
      initialTrips={initialTrips}
      initialSelectedSlug={initialSelectedSlug}
      initialPlan={initialPlan}
      initialSuggestions={initialSuggestions}
    />
  );
}

function Login() {
  return (
    <main className="admin-shell admin-login-shell">
      <section className="admin-login-card">
        <a href="/" className="admin-back">Về lịch</a>
        <h1>Quản lý chuyến đi</h1>
        <p>Đăng nhập bằng Google để xem lịch và gửi góp ý. Chỉ chủ lịch mới có quyền chỉnh sửa.</p>
        <button className="google-login" type="button" onClick={() => signIn("google", { redirectTo: ADMIN_ROUTES.trips })}>
          <GoogleIcon />
          Tiếp tục với Google
        </button>
      </section>
    </main>
  );
}

function ContributorOnly({ user }) {
  return (
    <main className="admin-shell admin-login-shell">
      <section className="admin-login-card">
        <a href="/" className="admin-back">Về lịch</a>
        <h1>Gửi góp ý trên lịch</h1>
        <p><strong>{user.email}</strong> đã đăng nhập. Bạn có thể comment hoặc tạo suggestion ở từng mục lịch, nhưng không thể sửa trực tiếp trip plan.</p>
        <a className="google-login contributor-link" href="/">Mở lịch để góp ý</a>
        <button className="admin-ghost contributor-logout" type="button" onClick={() => signOut({ redirectTo: "/" })}>Đăng xuất</button>
      </section>
    </main>
  );
}

function Dashboard({ user, initialTrips, initialSelectedSlug, initialPlan, initialSuggestions }) {
  const [trips, setTrips] = useState(initialTrips);
  const [selectedSlug, setSelectedSlug] = useState(initialSelectedSlug);
  const [plan, setPlan] = useState(initialPlan);
  const [tripEditor, setTripEditor] = useState(null);
  const [scheduleEditor, setScheduleEditor] = useState(null);
  const [sourceEditor, setSourceEditor] = useState(false);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [discardPrompt, setDiscardPrompt] = useState(null);
  const pendingScheduleActionRef = useRef(null);
  const scheduleReturnFocusRef = useRef(null);
  const scheduleDirty = scheduleEditorIsDirty(scheduleEditor);

  useEffect(() => {
    if (!scheduleEditor) return undefined;
    const frame = requestAnimationFrame(() => {
      const editor = document.getElementById(`schedule-editor-${scheduleEditor.key}`);
      if (!editor) return;
      editor.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "nearest",
      });
      editor.querySelector("[data-editor-heading]")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [scheduleEditor?.key]);

  useEffect(() => {
    if (!scheduleDirty) return undefined;
    const protectDraft = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [scheduleDirty]);

  const guardScheduleDraft = (action, message) => {
    if (!scheduleDirty) { action(); return; }
    pendingScheduleActionRef.current = action;
    setDiscardPrompt({ message });
  };

  const activateScheduleEditor = (values, trigger) => {
    if (busy) return;
    const nextEditor = createScheduleEditor(values);
    if (scheduleEditor?.key === nextEditor.key) {
      document.getElementById(`schedule-editor-${nextEditor.key}`)?.querySelector("[data-editor-heading]")?.focus();
      return;
    }
    guardScheduleDraft(() => {
      scheduleReturnFocusRef.current = trigger;
      setScheduleError("");
      setScheduleEditor(nextEditor);
    }, `Bạn có thay đổi chưa lưu trong “${scheduleEditor?.values.title || "hoạt động hiện tại"}”.`);
  };

  const closeScheduleEditor = () => {
    if (busy) return;
    guardScheduleDraft(() => {
      setScheduleEditor(null);
      setScheduleError("");
      requestAnimationFrame(() => scheduleReturnFocusRef.current?.focus?.());
    }, `Bạn có thay đổi chưa lưu trong “${scheduleEditor?.values.title || "hoạt động hiện tại"}”.`);
  };

  const keepScheduleDraft = () => {
    pendingScheduleActionRef.current = null;
    setDiscardPrompt(null);
  };

  const discardScheduleDraft = () => {
    const action = pendingScheduleActionRef.current;
    pendingScheduleActionRef.current = null;
    setDiscardPrompt(null);
    action?.();
  };

  const loadTrips = useCallback(async (preferredSlug) => {
    const data = await api("/api/trips");
    setTrips(data.trips);
    const nextSlug = preferredSlug || data.trips[0]?.slug || "";
    setSelectedSlug(nextSlug);
    return nextSlug;
  }, []);

  const refreshPlan = useCallback(async (slug) => {
    if (!slug) {
      setPlan(null);
      setSuggestions([]);
      return;
    }
    setLoadingPlan(true);
    try {
      const [nextPlan, suggestionData] = await Promise.all([
        api(`/api/trips/${encodeURIComponent(slug)}`),
        api(`/api/trips/${encodeURIComponent(slug)}/suggestions`),
      ]);
      setPlan(nextPlan);
      setSuggestions(suggestionData.suggestions);
    } finally {
      setLoadingPlan(false);
    }
  }, []);

  const selectTrip = (slug, trigger) => {
    if (slug === selectedSlug || loadingPlan) return;
    guardScheduleDraft(() => {
      scheduleReturnFocusRef.current = trigger;
      setTripEditor(null);
      setScheduleEditor(null);
      setSourceEditor(false);
      setSelectedSlug(slug);
      setError("");
      setNotice("");
      setScheduleError("");
      refreshPlan(slug).catch((requestError) => setError(requestError.message));
    }, `Bạn có thay đổi chưa lưu trong “${scheduleEditor?.values.title || "hoạt động hiện tại"}”.`);
  };

  const run = async (action) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const saveTrip = (values, originalSlug) => run(async () => {
    const saved = originalSlug
      ? await api(`/api/trips/${encodeURIComponent(originalSlug)}`, { method: "PATCH", body: JSON.stringify(values) })
      : await api("/api/trips", { method: "POST", body: JSON.stringify(values) });
    setTripEditor(null);
    const nextSlug = await loadTrips(saved.slug);
    await refreshPlan(nextSlug);
  });

  const removeTrip = (slug) => {
    if (!window.confirm(`Xoá trip “${slug}” và toàn bộ schedule?`)) return;
    run(async () => {
      await api(`/api/trips/${encodeURIComponent(slug)}`, { method: "DELETE" });
      setPlan(null); setSuggestions([]); setSelectedSlug("");
      const nextSlug = await loadTrips();
      await refreshPlan(nextSlug);
    });
  };

  const saveSchedule = async (values, activityId) => {
    setBusy(true); setScheduleError(""); setError(""); setNotice("");
    try {
      const payload = {
        ...values,
        displayEnd: values.displayEnd || null,
        refs: normalizeScheduleRefs(values.refs),
      };
      delete payload.id;
      const base = `/api/trips/${encodeURIComponent(selectedSlug)}/schedule`;
      await api(activityId ? `${base}/${activityId}` : base, {
        method: activityId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
    } catch (requestError) {
      setScheduleError(requestError.message);
      setBusy(false);
      return;
    }
    setScheduleEditor(null);
    setNotice(activityId ? "Đã lưu thay đổi hoạt động." : "Đã thêm hoạt động mới.");
    try {
      await Promise.all([refreshPlan(selectedSlug), loadTrips(selectedSlug)]);
      requestAnimationFrame(() => scheduleReturnFocusRef.current?.focus?.());
    } catch (requestError) {
      setError(`Hoạt động đã được lưu nhưng chưa thể tải lại lịch: ${requestError.message}`);
    } finally {
      setBusy(false);
    }
  };

  const createSourceForPlan = async (values) => {
    const source = await api(`/api/trips/${encodeURIComponent(selectedSlug)}/sources`, {
      method: "POST",
      body: JSON.stringify(values),
    });
    setPlan((current) => current ? { ...current, sources: [...current.sources, source] } : current);
    return source;
  };

  const saveSource = async (values) => {
    const source = await createSourceForPlan(values);
    setSourceEditor(false);
    setNotice(`Đã thêm nguồn ${source.number}: ${source.title}`);
    return source;
  };

  const removeSchedule = (activityId) => {
    if (!window.confirm("Xoá schedule item này?")) return;
    run(async () => {
      await api(`/api/trips/${encodeURIComponent(selectedSlug)}/schedule/${activityId}`, { method: "DELETE" });
      await Promise.all([refreshPlan(selectedSlug), loadTrips(selectedSlug)]);
    });
  };

  const updateSuggestion = (suggestionId, status) => run(async () => {
    const updated = await api(`/api/trips/${encodeURIComponent(selectedSlug)}/suggestions/${suggestionId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    setSuggestions((current) => current.map((item) => item.id === suggestionId ? updated : item));
  });

  const removeSuggestion = (suggestionId) => {
    if (!window.confirm("Xoá vĩnh viễn góp ý này?")) return;
    run(async () => {
      await api(`/api/trips/${encodeURIComponent(selectedSlug)}/suggestions/${suggestionId}`, { method: "DELETE" });
      setSuggestions((current) => current.filter((item) => item.id !== suggestionId));
    });
  };

  const logout = () => signOut({ redirectTo: "/" });

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <a href="/" className="admin-back">Về lịch</a>
          <h1>Quản lý lịch</h1>
          <small className="admin-user">{user.authMode === "local-dev" ? "Local admin · Docker Postgres" : user.email}</small>
        </div>
        {user.authMode !== "local-dev" && <button className="admin-ghost" onClick={logout}>Đăng xuất</button>}
      </header>
      {error && <div className="admin-alert" role="alert">{error}<button onClick={() => setError("")} aria-label="Đóng thông báo"><ActionIcon name="close" /></button></div>}
      {notice && <div className="admin-notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Đóng thông báo"><ActionIcon name="close" /></button></div>}

      <AdminNav active="trips" />

      <div className="admin-grid">
        <aside className="admin-sidebar">
          <div className="admin-section-head"><h2>Trip plans</h2><button className="admin-primary small" onClick={(event) => guardScheduleDraft(() => { setScheduleEditor(null); setTripEditor({ values: emptyTrip, originalSlug: null }); }, `Bạn có thay đổi chưa lưu trong “${scheduleEditor?.values.title || "hoạt động hiện tại"}”.`)}>Thêm</button></div>
          <div className="trip-list">
            {trips.map((trip) => (
              <button className={`trip-list-item${selectedSlug === trip.slug ? " active" : ""}`} onClick={(event) => selectTrip(trip.slug, event.currentTarget)} disabled={loadingPlan} key={trip.slug}>
                <strong>{trip.title}</strong><span>{trip.date} · {trip.scheduleCount} mục</span>
              </button>
            ))}
            {!trips.length && <p className="admin-empty">Chưa có trip.</p>}
          </div>
        </aside>

        <section className="admin-content">
          {tripEditor && <TripForm editor={tripEditor} busy={busy} onSave={saveTrip} onCancel={() => setTripEditor(null)} />}
          {!tripEditor && loadingPlan && <PlanSkeleton />}
          {!tripEditor && !loadingPlan && plan && (
            <>
              <div className="plan-summary">
                <div><h2>{plan.trip.title}</h2><p>{plan.trip.date} · {plan.trip.location} · {plan.trip.timezone}</p></div>
                <div className="admin-actions">
                  <button className="admin-ghost" onClick={() => guardScheduleDraft(() => { setScheduleEditor(null); setTripEditor({ values: plan.trip, originalSlug: plan.trip.slug }); }, `Bạn có thay đổi chưa lưu trong “${scheduleEditor?.values.title || "hoạt động hiện tại"}”.`)}>Sửa trip</button>
                  <button className="admin-danger" onClick={() => removeTrip(plan.trip.slug)}>Xoá</button>
                </div>
              </div>

              <section className="admin-sources" aria-labelledby="admin-sources-title">
                <div className="admin-section-head source-heading">
                  <div><h2 id="admin-sources-title">{plan.sources.length} nguồn địa điểm</h2></div>
                  <button className="admin-primary" type="button" onClick={() => setSourceEditor((current) => !current)} aria-expanded={sourceEditor}>
                    {sourceEditor ? "Hủy thêm" : "Thêm nguồn"}
                  </button>
                </div>
                {sourceEditor && <SourceForm onSave={saveSource} onCancel={() => setSourceEditor(false)} />}
                <div className="admin-source-list">
                  {plan.sources.map((source) => (
                    <a className="admin-source-item" href={source.url} target="_blank" rel="noreferrer" key={source.number}>
                      <span className="admin-source-number">{String(source.number).padStart(2, "0")}</span>
                      <span className="admin-source-copy"><strong>{source.title}</strong><small>{source.host}</small></span>
                      <ActionIcon name="external" />
                    </a>
                  ))}
                  {!plan.sources.length && <p className="admin-empty">Chưa có nguồn. Thêm nguồn đầu tiên để gắn vào hoạt động.</p>}
                </div>
              </section>

              <div className="admin-section-head schedule-heading"><div><h2>{plan.itinerary.length} hoạt động</h2></div><button className="admin-primary" disabled={busy} aria-expanded={scheduleEditor?.key === "new"} aria-controls="schedule-editor-new" onClick={(event) => activateScheduleEditor(emptySchedule, event.currentTarget)}>Thêm hoạt động</button></div>
              {scheduleEditor?.key === "new" && (
                <ScheduleForm
                  key="new"
                  editor={scheduleEditor}
                  busy={busy}
                  error={scheduleError}
                  sources={plan.sources}
                  placement="create"
                  onChange={(values) => setScheduleEditor((current) => current ? { ...current, values } : current)}
                  onCreateSource={createSourceForPlan}
                  onSave={saveSchedule}
                  onCancel={closeScheduleEditor}
                />
              )}
              <div className="admin-schedule-list">
                {plan.itinerary.map((item) => {
                  const editorId = `schedule-editor-${item.id}`;
                  const isEditing = scheduleEditor?.key === String(item.id);
                  return (
                    <article className={`admin-schedule-item${isEditing ? " is-editing" : ""}`} key={item.id}>
                      <div className="admin-schedule-time"><strong>{item.start}</strong><span>{item.displayEnd || item.end}</span></div>
                      <div className="admin-schedule-copy"><span><TypeIcon type={item.type} /> {item.type}</span><h3>{item.title}</h3><p>{item.detail}</p></div>
                      <div className="admin-row-actions">
                        <button className="admin-ghost" disabled={busy} aria-expanded={isEditing} aria-controls={editorId} onClick={(event) => activateScheduleEditor(item, event.currentTarget)}>{isEditing ? "Đang sửa" : "Sửa"}</button>
                        <button className="admin-danger" disabled={busy} onClick={() => removeSchedule(item.id)}>Xoá</button>
                      </div>
                      {isEditing && (
                        <ScheduleForm
                          key={scheduleEditor.key}
                          editor={scheduleEditor}
                          busy={busy}
                          error={scheduleError}
                          sources={plan.sources}
                          placement="inline"
                          onChange={(values) => setScheduleEditor((current) => current ? { ...current, values } : current)}
                          onCreateSource={createSourceForPlan}
                          onSave={saveSchedule}
                          onCancel={closeScheduleEditor}
                        />
                      )}
                    </article>
                  );
                })}
              </div>

              <div className="admin-section-head suggestion-admin-heading"><div><h2>{suggestions.length} góp ý</h2></div></div>
              <div className="admin-suggestion-list">
                {suggestions.map((suggestion) => {
                  const activity = plan.itinerary.find((item) => item.id === suggestion.activityId);
                  return (
                    <article className="admin-suggestion-item" key={suggestion.id}>
                      <div className="admin-suggestion-meta">
                        <span>{suggestion.kind === "comment" ? "Bình luận" : "Đề xuất"}</span>
                        <strong>{suggestion.author.name}</strong>
                        <small>{suggestion.author.email}</small>
                      </div>
                      <div className="admin-suggestion-copy">
                        <small>{activity ? `${activity.start} · ${activity.title}` : "Góp ý chung cho chuyến đi"}</small>
                        <p>{suggestion.body}</p>
                      </div>
                      <div className="admin-suggestion-controls">
                        <select value={suggestion.status} onChange={(event) => updateSuggestion(suggestion.id, event.target.value)} disabled={busy} aria-label="Trạng thái góp ý">
                          <option value="open">Mới</option>
                          <option value="accepted">Đã nhận</option>
                          <option value="resolved">Đã xử lý</option>
                          <option value="rejected">Từ chối</option>
                        </select>
                        <button className="admin-danger" onClick={() => removeSuggestion(suggestion.id)}>Xoá</button>
                      </div>
                    </article>
                  );
                })}
                {!suggestions.length && <p className="admin-empty">Chưa có góp ý nào.</p>}
              </div>
            </>
          )}
          {!tripEditor && !loadingPlan && !plan && <div className="admin-empty large">Chọn hoặc tạo một trip plan.</div>}
        </section>
      </div>
      {discardPrompt && <DiscardChangesDialog message={discardPrompt.message} onKeep={keepScheduleDraft} onDiscard={discardScheduleDraft} />}
    </main>
  );
}

function PlanSkeleton() {
  return (
    <div className="admin-plan-skeleton" aria-live="polite" aria-label="Đang tải trip plan">
      <span /><strong /><span />
      <div>{[0, 1, 2, 3].map((item) => <span key={item} />)}</div>
    </div>
  );
}

function TripForm({ editor, busy, onSave, onCancel }) {
  const [values, setValues] = useState(editor.values);
  const field = (name) => ({ value: values[name] || "", onChange: (event) => setValues({ ...values, [name]: event.target.value }) });
  return (
    <form className="admin-editor admin-form" onSubmit={(event) => { event.preventDefault(); onSave(values, editor.originalSlug); }}>
      <div className="admin-section-head"><h2>{editor.originalSlug ? "Sửa trip" : "Trip mới"}</h2><button type="button" className="admin-ghost" onClick={onCancel}>Đóng</button></div>
      <div className="form-grid"><label>Slug<input {...field("slug")} placeholder="tokyo-2026-08-10" required /></label><label>Tên trip<input {...field("title")} required /></label><label>Ngày<input type="date" {...field("date")} required /></label><label>Timezone<input {...field("timezone")} required /></label><label className="wide">Địa điểm<input {...field("location")} required /></label></div>
      <button className="admin-primary" disabled={busy}>{busy ? "Đang lưu…" : "Lưu trip"}</button>
    </form>
  );
}

function ScheduleForm({ editor, busy, error, sources, placement, onChange, onCreateSource, onSave, onCancel }) {
  const values = editor.values;
  const field = (name) => ({ value: values[name] ?? "", onChange: (event) => onChange({ ...values, [name]: event.target.value }) });
  return (
    <form id={`schedule-editor-${editor.key}`} className={`admin-editor admin-form schedule-editor ${placement === "inline" ? "schedule-inline-editor" : "schedule-create-editor"}`} onSubmit={(event) => { event.preventDefault(); onSave(values, values.id); }}>
      <div className="admin-section-head schedule-editor-head">
        <h2 tabIndex="-1" data-editor-heading>{values.id ? `Sửa: ${values.title || "Hoạt động"}` : "Hoạt động mới"}</h2>
        <button type="button" className="admin-ghost" onClick={onCancel} disabled={busy}>Hủy</button>
      </div>
      <div className="form-grid schedule-form-grid">
        <label>Bắt đầu<input type="time" {...field("start")} required /></label>
        <label>Kết thúc<input type="time" {...field("end")} required /></label>
        <label>Hiển thị kết thúc<input {...field("displayEnd")} placeholder="Tuỳ chọn, ví dụ +" /></label>
        <label>Loại<input {...field("type")} required /></label>
        <label>Icon<input {...field("icon")} required /></label>
        <label className="wide">Tiêu đề<input {...field("title")} required /></label>
        <label className="wide">Chi tiết<textarea {...field("detail")} rows="4" required /></label>
      </div>
      <SourcePicker
        sources={sources}
        selectedRefs={values.refs}
        onChange={(refs) => onChange({ ...values, refs })}
        onCreateSource={onCreateSource}
      />
      {error && <p className="form-error schedule-form-error" role="alert">{error}</p>}
      <div className="schedule-editor-actions">
        <button type="button" className="admin-ghost" onClick={onCancel} disabled={busy}>Hủy</button>
        <button className="admin-primary" disabled={busy}>{busy ? "Đang lưu…" : values.id ? "Lưu thay đổi" : "Thêm hoạt động"}</button>
      </div>
    </form>
  );
}

function SourcePicker({ sources, selectedRefs, onChange, onCreateSource }) {
  const [addingSource, setAddingSource] = useState(false);
  const [creatingSource, setCreatingSource] = useState(false);
  const [createdNotice, setCreatedNotice] = useState("");
  const refs = normalizeScheduleRefs(selectedRefs);
  const toggleSource = (number) => {
    const next = refs.includes(number) ? refs.filter((ref) => ref !== number) : [...refs, number];
    onChange(normalizeScheduleRefs(next));
  };
  const createAndSelectSource = async (values) => {
    setCreatingSource(true);
    try {
      const source = await onCreateSource(values);
      onChange(normalizeScheduleRefs([...refs, source.number]));
      setAddingSource(false);
      setCreatedNotice(`Đã thêm và chọn “${source.title}”.`);
      return source;
    } finally {
      setCreatingSource(false);
    }
  };
  return (
    <fieldset className="source-picker">
      <legend>Nguồn tham khảo</legend>
      <div className="source-picker-frame">
        <div className="source-picker-head">
          <p>{sources.length ? "Chọn các nguồn xác nhận thông tin cho hoạt động này." : "Chuyến đi này chưa có nguồn tham khảo."}</p>
          {!addingSource && <button type="button" className="admin-ghost" onClick={() => { setAddingSource(true); setCreatedNotice(""); }}>{sources.length ? "Thêm nguồn mới" : "Thêm nguồn đầu tiên"}</button>}
        </div>
        {sources.length > 0 && (
          <div className="source-picker-list">
            {sources.map((source) => (
              <label className="source-option" key={source.number}>
                <input type="checkbox" checked={refs.includes(source.number)} onChange={() => toggleSource(source.number)} disabled={creatingSource} />
                <span className="source-option-number">{String(source.number).padStart(2, "0")}</span>
                <span className="source-option-copy"><strong>{source.title}</strong><small>{source.host}</small></span>
              </label>
            ))}
          </div>
        )}
        {addingSource && <SourceForm compact onSave={createAndSelectSource} onCancel={() => setAddingSource(false)} />}
        {createdNotice && <p className="source-created-notice" role="status">{createdNotice}</p>}
      </div>
    </fieldset>
  );
}

function SourceForm({ compact = false, onSave, onCancel }) {
  const [values, setValues] = useState(emptySource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fieldsRef = useRef(null);
  const hintId = useId();
  const field = (name) => ({ value: values[name], onChange: (event) => setValues({ ...values, [name]: event.target.value }) });
  const submitSource = async (event) => {
    event?.preventDefault?.();
    if (compact) {
      if (!values.title.trim()) { setError("Hãy nhập tên nguồn."); fieldsRef.current?.querySelector("input")?.focus(); return; }
      try {
        const parsed = new URL(values.url);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch { setError("URL phải bắt đầu bằng http:// hoặc https://."); fieldsRef.current?.querySelectorAll("input")?.[1]?.focus(); return; }
    }
    setBusy(true); setError("");
    try { await onSave(values); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  const fields = (
    <div className={compact ? "source-inline-fields" : "form-grid"} ref={fieldsRef}>
      <label className={compact ? "" : "wide"}>Tên nguồn<input {...field("title")} maxLength={300} placeholder="Ví dụ: Trang chính thức của bảo tàng" required={!compact} /></label>
      <label className={compact ? "" : "wide"}>URL<input type={compact ? "text" : "url"} inputMode="url" autoCapitalize="none" spellCheck={false} {...field("url")} maxLength={2000} placeholder="https://example.com/dia-diem" aria-describedby={hintId} required={!compact} /><small id={hintId}>Tên miền và số nguồn được tạo tự động.</small></label>
    </div>
  );
  if (compact) {
    return (
      <section className="source-inline-form" onKeyDown={(event) => { if (event.key === "Enter" && event.target.tagName === "INPUT") submitSource(event); }}>
        <div className="source-inline-head"><strong>Thêm nguồn mới</strong><button type="button" className="admin-ghost" onClick={onCancel}>Hủy</button></div>
        {fields}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="button" className="admin-primary" onClick={submitSource} disabled={busy}>{busy ? "Đang thêm…" : "Thêm và chọn nguồn"}</button>
      </section>
    );
  }
  return (
    <form className="admin-editor admin-form source-form" onSubmit={submitSource}>
      <div className="admin-section-head"><h2>Nguồn mới</h2><button type="button" className="admin-ghost" onClick={onCancel}>Hủy</button></div>
      {fields}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="admin-primary" disabled={busy}>{busy ? "Đang thêm…" : "Thêm nguồn"}</button>
    </form>
  );
}

function DiscardChangesDialog({ message, onKeep, onDiscard }) {
  const dialogRef = useRef(null);
  const safeActionRef = useRef(null);
  const returnFocusRef = useRef(null);
  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    safeActionRef.current?.focus();
    const handleEscape = (event) => { if (event.key === "Escape") onKeep(); };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      returnFocusRef.current?.focus?.();
    };
  }, []);
  const keepFocusInside = (event) => {
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll("button");
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return (
    <div className="suggestion-overlay discard-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onKeep(); }}>
      <section className="discard-dialog" role="dialog" aria-modal="true" aria-labelledby="discard-dialog-title" aria-describedby="discard-dialog-copy" ref={dialogRef} onKeyDown={keepFocusInside}>
        <h2 id="discard-dialog-title">Bỏ thay đổi chưa lưu?</h2>
        <p id="discard-dialog-copy">{message} Bạn muốn tiếp tục sửa hay bỏ bản nháp để chuyển sang mục khác?</p>
        <div className="discard-dialog-actions">
          <button type="button" className="admin-primary" onClick={onKeep} ref={safeActionRef}>Tiếp tục sửa</button>
          <button type="button" className="admin-danger" onClick={onDiscard}>Bỏ thay đổi</button>
        </div>
      </section>
    </div>
  );
}

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
