"use client";

import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { ADMIN_ROUTES } from "../lib/admin-routes.mjs";
import { createScheduleEditor, normalizeScheduleRefs, scheduleEditorIsDirty } from "../lib/schedule-editor-state.mjs";
import { ActionIcon, TypeIcon } from "./Icons";
import AdminNav from "./AdminNav";
import ConfirmDialog from "./ConfirmDialog";

const emptyTrip = { slug: "", title: "", date: "", timezone: "Asia/Tokyo", location: "" };
const emptySchedule = { start: "", end: "", displayEnd: "", type: "Visit", icon: "📍", title: "", detail: "", refs: [] };
const emptySource = { title: "", url: "" };
const JST_OFFSET = "+09:00";
const TRIP_START_BRANCH_ANCHOR = "trip-start";
const ACTIVITY_TYPES = [
  { value: "Transit", label: "Di chuyển", icon: "🚆" },
  { value: "Walk", label: "Đi bộ", icon: "🚶" },
  { value: "Visit", label: "Tham quan", icon: "📍" },
  { value: "Film", label: "Quay phim / chụp ảnh", icon: "🎬📷" },
  { value: "Buffer", label: "Thời gian đệm", icon: "🧊" },
  { value: "Rest", label: "Nghỉ", icon: "☕" },
  { value: "Cafe", label: "Quán cà phê", icon: "☕" },
  { value: "Lunch", label: "Ăn trưa", icon: "🍜" },
  { value: "Dinner", label: "Ăn tối", icon: "🍽️" },
  { value: "Indoor", label: "Trong nhà", icon: "🏠" },
];
const ACTIVITY_ICONS = [
  { value: "🚆", label: "Tàu / di chuyển" },
  { value: "🚃", label: "Tàu điện / Enoden" },
  { value: "🚶", label: "Đi bộ" },
  { value: "📍", label: "Địa điểm" },
  { value: "🎬📷", label: "Quay phim / chụp ảnh" },
  { value: "🧊", label: "Thời gian đệm" },
  { value: "☕", label: "Nghỉ / cà phê" },
  { value: "🍜", label: "Món ăn" },
  { value: "🍽️", label: "Bữa ăn" },
  { value: "🏠", label: "Trong nhà" },
  { value: "⛩️", label: "Đền / chùa" },
  { value: "🏛️", label: "Điểm tham quan" },
];

const includeCurrentOption = (options, value, label = value) => (
  value && !options.some((option) => option.value === value)
    ? [{ value, label: `${label} · đang dùng` }, ...options]
    : options
);

const openTimePicker = (event) => {
  try {
    event.currentTarget.showPicker?.();
  } catch {
    // Browsers without a programmable native picker still keep the normal time input behavior.
  }
};

const hasTripStarted = (plan) => {
  const firstActivity = plan?.itinerary?.[0];
  if (!plan?.trip?.date || !firstActivity?.start) return false;
  return Date.now() >= new Date(`${plan.trip.date}T${firstActivity.start}:00${JST_OFFSET}`).getTime();
};

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...options.headers } : options.headers,
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
};

export default function AdminApp({ viewer, initialTrips, initialSelectedSlug, initialPlan, initialSuggestions, pendingInvitationCount = 0 }) {
  if (!viewer?.email) return <Login />;
  if (!viewer.isAdmin) return <ContributorOnly user={viewer} />;
  return (
    <Dashboard
      user={viewer}
      initialTrips={initialTrips}
      initialSelectedSlug={initialSelectedSlug}
      initialPlan={initialPlan}
      initialSuggestions={initialSuggestions}
      pendingInvitationCount={pendingInvitationCount}
    />
  );
}

function Login() {
  return (
    <main className="admin-shell admin-login-shell">
      <section className="admin-login-card">
        <Link href="/" className="admin-back">Về lịch</Link>
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
        <Link href="/" className="admin-back">Về lịch</Link>
        <h1>Gửi góp ý trên lịch</h1>
        <p><strong>{user.email}</strong> đã đăng nhập. Bạn có thể comment hoặc tạo suggestion ở từng mục lịch, nhưng không thể sửa trực tiếp trip plan.</p>
        <Link className="google-login contributor-link" href="/">Mở lịch để góp ý</Link>
        <button className="admin-ghost contributor-logout" type="button" onClick={() => signOut({ redirectTo: "/" })}>Đăng xuất</button>
      </section>
    </main>
  );
}

function Dashboard({ user, initialTrips, initialSelectedSlug, initialPlan, initialSuggestions, pendingInvitationCount }) {
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
  const [branchCreatorAnchorId, setBranchCreatorAnchorId] = useState(null);
  const [discardPrompt, setDiscardPrompt] = useState(null);
  const [suggestionFilter, setSuggestionFilter] = useState("visible");
  const [suggestionToDelete, setSuggestionToDelete] = useState(null);
  const [suggestionDeleteError, setSuggestionDeleteError] = useState("");
  const pendingScheduleActionRef = useRef(null);
  const scheduleReturnFocusRef = useRef(null);
  const scheduleDirty = scheduleEditorIsDirty(scheduleEditor);
  const scheduleEditorKey = scheduleEditor?.key;

  useEffect(() => {
    if (!scheduleEditorKey) return undefined;
    const frame = requestAnimationFrame(() => {
      const editor = document.getElementById(`schedule-editor-${scheduleEditorKey}`);
      if (!editor) return;
      editor.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "nearest",
      });
      editor.querySelector("[data-editor-heading]")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [scheduleEditorKey]);

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

  const applyBranchMutation = async (path, options, message) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const nextPlan = await api(path, options);
      setPlan(nextPlan);
      await loadTrips(selectedSlug);
      setNotice(message);
      return nextPlan;
    } catch (requestError) {
      setError(requestError.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const createBranchGroupForPlan = async (values) => {
    const nextPlan = await applyBranchMutation(
      `/api/trips/${encodeURIComponent(selectedSlug)}/branches`,
      { method: "POST", body: JSON.stringify(values) },
      "Đã tạo điểm rẽ và chuyển đoạn lịch sang phương án mặc định.",
    );
    if (nextPlan) setBranchCreatorAnchorId(null);
  };

  const activateBranchForPlan = (groupId, branchId) => {
    const branch = plan?.branchGroups
      ?.find((group) => group.id === groupId)
      ?.branches.find((option) => option.id === branchId);
    if (branch && hasTripStarted(plan) && !window.confirm(`Chuyến đi đã bắt đầu. Đổi sang “${branch.label}” có thể làm thay đổi hoạt động hiện tại và tiếp theo. Tiếp tục?`)) {
      return Promise.resolve(null);
    }
    return applyBranchMutation(
      `/api/trips/${encodeURIComponent(selectedSlug)}/branches/${groupId}/selection`,
      { method: "PUT", body: JSON.stringify({ branchId }) },
      "Đã đổi phương án đang dùng cho cả nhóm.",
    );
  };

  const addBranchOptionForPlan = (groupId, values) => applyBranchMutation(
    `/api/trips/${encodeURIComponent(selectedSlug)}/branches/${groupId}`,
    { method: "POST", body: JSON.stringify(values) },
    "Đã thêm phương án dự phòng.",
  );

  const updateBranchOptionForPlan = (groupId, branchId, values) => applyBranchMutation(
    `/api/trips/${encodeURIComponent(selectedSlug)}/branches/${groupId}/${branchId}`,
    { method: "PATCH", body: JSON.stringify(values) },
    "Đã lưu thông tin phương án.",
  );

  const deleteBranchOptionForPlan = (groupId, branchId) => applyBranchMutation(
    `/api/trips/${encodeURIComponent(selectedSlug)}/branches/${groupId}/${branchId}`,
    { method: "DELETE" },
    "Đã xoá phương án dự phòng.",
  );

  const unwrapBranchGroupForPlan = (groupId, keepBranchId) => applyBranchMutation(
    `/api/trips/${encodeURIComponent(selectedSlug)}/branches/${groupId}`,
    { method: "DELETE", body: JSON.stringify({ keepBranchId }) },
    "Đã gỡ điểm rẽ và giữ phương án đã chọn trên tuyến chính.",
  );

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

  const updateSuggestionVisibility = (suggestion) => run(async () => {
    const updated = await api(`/api/trips/${encodeURIComponent(selectedSlug)}/suggestions/${suggestion.id}`, {
      method: "PATCH",
      body: JSON.stringify({ hidden: !suggestion.hidden }),
    });
    setSuggestions((current) => current.map((item) => item.id === suggestion.id ? updated : item));
    setNotice(updated.hidden ? "Đã ẩn nội dung khỏi lịch công khai." : "Đã hiện lại nội dung trên lịch.");
  });

  const requestRemoveSuggestion = (suggestion) => {
    setSuggestionDeleteError("");
    setSuggestionToDelete(suggestion);
  };

  const confirmRemoveSuggestion = async () => {
    if (!suggestionToDelete) return;
    setBusy(true);
    setSuggestionDeleteError("");
    try {
      await api(`/api/trips/${encodeURIComponent(selectedSlug)}/suggestions/${suggestionToDelete.id}`, { method: "DELETE" });
      setSuggestions((current) => current.filter((item) => item.id !== suggestionToDelete.id));
      setSuggestionToDelete(null);
      setNotice("Đã xoá vĩnh viễn nội dung.");
    } catch (requestError) {
      setSuggestionDeleteError(`${requestError.message}. Hãy thử lại.`);
    } finally {
      setBusy(false);
    }
  };

  const logout = () => signOut({ redirectTo: "/" });
  const startBranchGroup = plan?.branchGroups?.find((group) => group.anchorActivityId == null) || null;
  const backbone = plan?.backbone || plan?.itinerary || [];
  const occupiedBranchAnchors = new Set((plan?.branchGroups || []).map((group) => group.anchorActivityId).filter(Boolean));
  const firstOccupiedBackboneIndex = backbone.findIndex((activity) => occupiedBranchAnchors.has(activity.id));
  const startBranchBoundary = firstOccupiedBackboneIndex >= 0 ? firstOccupiedBackboneIndex : backbone.length - 1;
  const startBranchFollowing = backbone.slice(0, startBranchBoundary + 1);

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <Link href="/" className="admin-back">Về lịch</Link>
          <h1>Quản lý lịch</h1>
          <small className="admin-user">{user.authMode === "local-dev" ? "Local admin · Docker Postgres" : user.email}</small>
        </div>
        {user.authMode !== "local-dev" && <button className="admin-ghost" onClick={logout}>Đăng xuất</button>}
      </header>
      {error && <div className="admin-alert" role="alert">{error}<button onClick={() => setError("")} aria-label="Đóng thông báo"><ActionIcon name="close" /></button></div>}
      {notice && <div className="admin-notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Đóng thông báo"><ActionIcon name="close" /></button></div>}

      <AdminNav active="trips" pendingInvitationCount={pendingInvitationCount} />

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

              <div className="admin-section-head schedule-heading">
                <div><h2>{plan.itinerary.length} hoạt động đang dùng</h2><p>{plan.branchGroups?.length || 0} điểm rẽ</p></div>
                <div className="schedule-heading-actions">
                  {!startBranchGroup && startBranchFollowing.length > 1 && <button className="admin-ghost" type="button" disabled={busy} aria-expanded={branchCreatorAnchorId === TRIP_START_BRANCH_ANCHOR} onClick={() => setBranchCreatorAnchorId((current) => current === TRIP_START_BRANCH_ANCHOR ? null : TRIP_START_BRANCH_ANCHOR)}>Tạo điểm rẽ từ đầu</button>}
                  <button className="admin-primary" disabled={busy} aria-expanded={scheduleEditor?.key === "new"} aria-controls="schedule-editor-new" onClick={(event) => activateScheduleEditor(emptySchedule, event.currentTarget)}>Thêm hoạt động</button>
                </div>
              </div>
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
              {branchCreatorAnchorId === TRIP_START_BRANCH_ANCHOR && (
                <BranchCreateForm anchor={null} following={startBranchFollowing} busy={busy} onCancel={() => setBranchCreatorAnchorId(null)} onSave={createBranchGroupForPlan} />
              )}
              {startBranchGroup && (
                <div className="admin-trip-start-junction">
                  <BranchGroupAdmin
                    group={startBranchGroup}
                    startsTrip
                    busy={busy}
                    scheduleEditor={scheduleEditor}
                    scheduleError={scheduleError}
                    sources={plan.sources}
                    onActivate={activateBranchForPlan}
                    onAddOption={addBranchOptionForPlan}
                    onUpdateOption={updateBranchOptionForPlan}
                    onDeleteOption={deleteBranchOptionForPlan}
                    onUnwrap={unwrapBranchGroupForPlan}
                    onActivateEditor={activateScheduleEditor}
                    onEditorChange={(values) => setScheduleEditor((current) => current ? { ...current, values } : current)}
                    onCreateSource={createSourceForPlan}
                    onSaveSchedule={saveSchedule}
                    onCancelSchedule={closeScheduleEditor}
                    onRemoveSchedule={removeSchedule}
                  />
                </div>
              )}
              <div className="admin-schedule-list">
                {backbone.map((item, itemIndex, backboneItems) => {
                  const group = plan.branchGroups?.find((candidate) => candidate.anchorActivityId === item.id);
                  return (
                    <div className="admin-route-segment" key={item.id}>
                      <ScheduleRow
                        item={item}
                        busy={busy}
                        scheduleEditor={scheduleEditor}
                        scheduleError={scheduleError}
                        sources={plan.sources}
                        onActivateEditor={activateScheduleEditor}
                        onEditorChange={(values) => setScheduleEditor((current) => current ? { ...current, values } : current)}
                        onCreateSource={createSourceForPlan}
                        onSave={saveSchedule}
                        onCancel={closeScheduleEditor}
                        onRemove={removeSchedule}
                      />
                      {!group && itemIndex < backboneItems.length - 1 && (
                        <div className="admin-branch-entry">
                          <button className="admin-ghost" type="button" disabled={busy} aria-expanded={branchCreatorAnchorId === item.id} onClick={() => setBranchCreatorAnchorId((current) => current === item.id ? null : item.id)}>Tạo điểm rẽ sau mục này</button>
                        </div>
                      )}
                      {branchCreatorAnchorId === item.id && (
                        <BranchCreateForm anchor={item} following={backboneItems.slice(itemIndex + 1)} busy={busy} onCancel={() => setBranchCreatorAnchorId(null)} onSave={createBranchGroupForPlan} />
                      )}
                      {group && (
                        <BranchGroupAdmin
                          group={group}
                          busy={busy}
                          scheduleEditor={scheduleEditor}
                          scheduleError={scheduleError}
                          sources={plan.sources}
                          onActivate={activateBranchForPlan}
                          onAddOption={addBranchOptionForPlan}
                          onUpdateOption={updateBranchOptionForPlan}
                          onDeleteOption={deleteBranchOptionForPlan}
                          onUnwrap={unwrapBranchGroupForPlan}
                          onActivateEditor={activateScheduleEditor}
                          onEditorChange={(values) => setScheduleEditor((current) => current ? { ...current, values } : current)}
                          onCreateSource={createSourceForPlan}
                          onSaveSchedule={saveSchedule}
                          onCancelSchedule={closeScheduleEditor}
                          onRemoveSchedule={removeSchedule}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="admin-section-head suggestion-admin-heading">
                <div><h2>{suggestions.length} góp ý</h2><p>Quản lý trạng thái và mức hiển thị trên lịch công khai.</p></div>
                <div className="admin-suggestion-filters" role="group" aria-label="Lọc góp ý theo hiển thị">
                  <button type="button" aria-pressed={suggestionFilter === "visible"} onClick={() => setSuggestionFilter("visible")}>Đang hiện <span>{suggestions.filter((item) => !item.hidden).length}</span></button>
                  <button type="button" aria-pressed={suggestionFilter === "hidden"} onClick={() => setSuggestionFilter("hidden")}>Đã ẩn <span>{suggestions.filter((item) => item.hidden).length}</span></button>
                </div>
              </div>
              <div className="admin-suggestion-list">
                {suggestions.filter((suggestion) => suggestionFilter === "hidden" ? suggestion.hidden : !suggestion.hidden).map((suggestion) => {
                  const activity = [
                    ...(plan.backbone || plan.itinerary),
                    ...(plan.branchGroups || []).flatMap((group) => group.branches.flatMap((branch) => branch.itinerary)),
                  ].find((item) => item.id === suggestion.activityId);
                  return (
                    <article className={`admin-suggestion-item${suggestion.hidden ? " is-hidden" : ""}`} key={suggestion.id}>
                      <div className="admin-suggestion-meta">
                        <span>{suggestion.kind === "comment" ? "Bình luận" : "Đề xuất"}</span>
                        <strong>{suggestion.author.name}</strong>
                        <small>{suggestion.author.email}</small>
                        {suggestion.hidden && <em>Đã ẩn</em>}
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
                        <button className="admin-ghost" type="button" onClick={() => updateSuggestionVisibility(suggestion)} disabled={busy}>{suggestion.hidden ? "Hiện lại" : "Ẩn"}</button>
                        <AdminSuggestionMenu suggestion={suggestion} busy={busy} onDelete={requestRemoveSuggestion} />
                      </div>
                    </article>
                  );
                })}
                {!suggestions.length && <p className="admin-empty">Chưa có góp ý nào.</p>}
                {suggestions.length > 0 && !suggestions.some((suggestion) => suggestionFilter === "hidden" ? suggestion.hidden : !suggestion.hidden) && (
                  <p className="admin-empty">{suggestionFilter === "hidden" ? "Chưa có nội dung nào bị ẩn." : "Không còn nội dung đang hiển thị."}</p>
                )}
              </div>
            </>
          )}
          {!tripEditor && !loadingPlan && !plan && <div className="admin-empty large">Chọn hoặc tạo một trip plan.</div>}
        </section>
      </div>
      {discardPrompt && <DiscardChangesDialog message={discardPrompt.message} onKeep={keepScheduleDraft} onDiscard={discardScheduleDraft} />}
      {suggestionToDelete && (
        <ConfirmDialog
          title="Xoá vĩnh viễn nội dung này?"
          description={`Nội dung của ${suggestionToDelete.author.name} sẽ biến mất và không thể khôi phục.`}
          preview={suggestionToDelete.body}
          confirmLabel="Xoá vĩnh viễn"
          pendingLabel="Đang xoá…"
          pending={busy}
          error={suggestionDeleteError}
          onCancel={() => { setSuggestionToDelete(null); setSuggestionDeleteError(""); }}
          onConfirm={confirmRemoveSuggestion}
        />
      )}
    </main>
  );
}

function AdminSuggestionMenu({ suggestion, busy, onDelete }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const closeEscape = (event) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open]);

  return (
    <div className="admin-suggestion-menu" ref={rootRef}>
      <button className="admin-ghost" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} disabled={busy} ref={triggerRef}>Thêm</button>
      {open && <div><button className="admin-danger" type="button" onClick={() => onDelete(suggestion)}>Xoá vĩnh viễn</button></div>}
    </div>
  );
}

function ScheduleRow({ item, busy, scheduleEditor, scheduleError, sources, onActivateEditor, onEditorChange, onCreateSource, onSave, onCancel, onRemove }) {
  const editorId = `schedule-editor-${item.id}`;
  const isEditing = scheduleEditor?.key === String(item.id);
  return (
    <article className={`admin-schedule-item${isEditing ? " is-editing" : ""}`}>
      <div className="admin-schedule-time"><strong>{item.start}</strong><span>{item.displayEnd || item.end}</span></div>
      <div className="admin-schedule-copy"><span><TypeIcon type={item.type} /> {item.type}</span><h3>{item.title}</h3><p>{item.detail}</p></div>
      <div className="admin-row-actions">
        <button className="admin-ghost" disabled={busy} aria-expanded={isEditing} aria-controls={editorId} onClick={(event) => onActivateEditor(item, event.currentTarget)}>{isEditing ? "Đang sửa" : "Sửa"}</button>
        <button className="admin-danger" disabled={busy} onClick={() => onRemove(item.id)}>Xoá</button>
      </div>
      {isEditing && (
        <ScheduleForm
          key={scheduleEditor.key}
          editor={scheduleEditor}
          busy={busy}
          error={scheduleError}
          sources={sources}
          placement="inline"
          onChange={onEditorChange}
          onCreateSource={onCreateSource}
          onSave={onSave}
          onCancel={onCancel}
        />
      )}
    </article>
  );
}

function BranchCreateForm({ anchor, following, busy, onCancel, onSave }) {
  const startsTrip = anchor == null;
  const selectableActivities = startsTrip ? following.slice(0, -1) : following;
  const [segmentCount, setSegmentCount] = useState(1);
  const [values, setValues] = useState({
    title: "Phương án dự phòng",
    defaultLabel: "Kế hoạch hiện tại",
    defaultCondition: "Khi điều kiện bình thường",
    alternateLabel: "Phương án thay thế",
    alternateCondition: "Khi cần đổi kế hoạch",
  });
  const field = (name) => ({ value: values[name], onChange: (event) => setValues((current) => ({ ...current, [name]: event.target.value })) });
  const submit = (event) => {
    event.preventDefault();
    onSave({
      anchorActivityId: anchor?.id ?? null,
      segmentActivityIds: following.slice(0, segmentCount).map((item) => item.id),
      title: values.title,
      defaultBranch: { label: values.defaultLabel, condition: values.defaultCondition },
      alternateBranch: { label: values.alternateLabel, condition: values.alternateCondition },
    });
  };
  return (
    <form className={`admin-editor branch-create-editor${startsTrip ? " is-trip-start" : ""}`} onSubmit={submit}>
      <div className="admin-section-head"><div><h2>{startsTrip ? "Tạo điểm rẽ từ đầu chuyến" : `Tạo điểm rẽ sau “${anchor.title}”`}</h2><p>{startsTrip ? "Các hoạt động đầu tiên sẽ trở thành phương án mặc định; mọi tuyến hội nhập lại trước một hoạt động chung." : "Đoạn hiện có sẽ trở thành phương án mặc định."}</p></div><button className="admin-ghost" type="button" onClick={onCancel}>Hủy</button></div>
      <div className="form-grid">
        <label className="wide">Tên điểm rẽ<input {...field("title")} required /></label>
        <label className="wide">Hội nhập lại
          <select value={segmentCount} onChange={(event) => setSegmentCount(Number(event.target.value))}>
            {selectableActivities.map((item, index) => <option value={index + 1} key={item.id}>{index + 1 < following.length ? `Trước ${following[index + 1].start} · ${following[index + 1].title}` : "Cuối chuyến"}</option>)}
          </select>
        </label>
        <label>Tên phương án mặc định<input {...field("defaultLabel")} required /></label>
        <label>Điều kiện<input {...field("defaultCondition")} required /></label>
        <label>Tên phương án dự phòng<input {...field("alternateLabel")} required /></label>
        <label>Điều kiện<input {...field("alternateCondition")} required /></label>
      </div>
      <div className="schedule-editor-actions"><button className="admin-ghost" type="button" onClick={onCancel}>Hủy</button><button className="admin-primary" disabled={busy}>{busy ? "Đang tạo…" : `Chuyển ${segmentCount} hoạt động ${startsTrip ? "đầu tiên " : ""}thành điểm rẽ`}</button></div>
    </form>
  );
}

function BranchGroupAdmin({ group, startsTrip = false, busy, scheduleEditor, scheduleError, sources, onActivate, onAddOption, onUpdateOption, onDeleteOption, onUnwrap, onActivateEditor, onEditorChange, onCreateSource, onSaveSchedule, onCancelSchedule, onRemoveSchedule }) {
  const [adding, setAdding] = useState(false);
  const [newBranch, setNewBranch] = useState({ label: "", condition: "" });
  const [keepBranchId, setKeepBranchId] = useState(group.selectedBranchId);
  const selected = group.branches.find((branch) => branch.id === group.selectedBranchId) || group.branches[0];
  const unwrap = () => {
    if (!window.confirm(`Gỡ điểm rẽ và giữ “${group.branches.find((branch) => branch.id === keepBranchId)?.label}” trên tuyến chính? Các activity ở phương án khác sẽ bị xoá.`)) return;
    onUnwrap(group.id, keepBranchId);
  };
  return (
    <section className={`admin-branch-group${startsTrip ? " is-trip-start" : ""}`} aria-labelledby={`branch-group-${group.id}`}>
      <div className="admin-branch-head">
        <div><span>{startsTrip ? "Điểm rẽ đầu chuyến" : "Điểm rẽ"} · {group.branches.length} phương án</span><h3 id={`branch-group-${group.id}`}>{group.title}</h3><p>Đang dùng: <strong>{selected.label}</strong> · {selected.condition}</p></div>
        <button className="admin-ghost" type="button" onClick={() => setAdding((current) => !current)} disabled={busy}>{adding ? "Hủy thêm" : "Thêm phương án"}</button>
      </div>
      {adding && (
        <form className="branch-option-add" onSubmit={(event) => { event.preventDefault(); onAddOption(group.id, newBranch).then((plan) => { if (plan) { setAdding(false); setNewBranch({ label: "", condition: "" }); } }); }}>
          <label>Tên phương án<input value={newBranch.label} onChange={(event) => setNewBranch({ ...newBranch, label: event.target.value })} required /></label>
          <label>Điều kiện<input value={newBranch.condition} onChange={(event) => setNewBranch({ ...newBranch, condition: event.target.value })} required /></label>
          <button className="admin-primary" disabled={busy}>Thêm phương án</button>
        </form>
      )}
      <div className="admin-branch-options">
        {group.branches.map((branch) => (
          <BranchOptionAdmin
            key={branch.id}
            group={group}
            branch={branch}
            selected={branch.id === group.selectedBranchId}
            busy={busy}
            scheduleEditor={scheduleEditor}
            scheduleError={scheduleError}
            sources={sources}
            onActivate={onActivate}
            onUpdate={onUpdateOption}
            onDelete={onDeleteOption}
            onActivateEditor={onActivateEditor}
            onEditorChange={onEditorChange}
            onCreateSource={onCreateSource}
            onSaveSchedule={onSaveSchedule}
            onCancelSchedule={onCancelSchedule}
            onRemoveSchedule={onRemoveSchedule}
          />
        ))}
      </div>
      <div className="admin-branch-unwrap"><label>Giữ lại khi gỡ<select value={keepBranchId} onChange={(event) => setKeepBranchId(event.target.value)}>{group.branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.label}</option>)}</select></label><button className="admin-danger" type="button" onClick={unwrap} disabled={busy}>Gỡ điểm rẽ</button></div>
    </section>
  );
}

function BranchOptionAdmin({ group, branch, selected, busy, scheduleEditor, scheduleError, sources, onActivate, onUpdate, onDelete, onActivateEditor, onEditorChange, onCreateSource, onSaveSchedule, onCancelSchedule, onRemoveSchedule }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({ label: branch.label, condition: branch.condition });
  const newEditorKey = `new-branch-${branch.id}`;
  return (
    <article className={`admin-branch-option${selected ? " is-selected" : ""}`}>
      <div className="admin-branch-option-head">
        <div><span>{selected ? "Đang dùng" : "Dự phòng"}{branch.isDefault ? " · Mặc định" : ""}</span><h4>{branch.label}</h4><p>{branch.condition}</p></div>
        <div className="admin-row-actions">
          {!selected && <button className="admin-primary small" type="button" onClick={() => onActivate(group.id, branch.id)} disabled={busy}>Dùng phương án này</button>}
          <button className="admin-ghost" type="button" onClick={() => setEditing((current) => !current)} disabled={busy}>Sửa nhãn</button>
          {!selected && !branch.isDefault && group.branches.length > 2 && <button className="admin-danger" type="button" onClick={() => { if (window.confirm(`Xoá phương án “${branch.label}”?`)) onDelete(group.id, branch.id); }} disabled={busy}>Xoá</button>}
        </div>
      </div>
      {editing && (
        <form className="branch-option-edit" onSubmit={(event) => { event.preventDefault(); onUpdate(group.id, branch.id, values).then((plan) => { if (plan) setEditing(false); }); }}>
          <label>Tên<input value={values.label} onChange={(event) => setValues({ ...values, label: event.target.value })} required /></label>
          <label>Điều kiện<input value={values.condition} onChange={(event) => setValues({ ...values, condition: event.target.value })} required /></label>
          <button className="admin-primary" disabled={busy}>Lưu nhãn</button>
        </form>
      )}
      <div className="admin-branch-activities">
        {branch.itinerary.map((item) => (
          <ScheduleRow key={item.id} item={item} busy={busy} scheduleEditor={scheduleEditor} scheduleError={scheduleError} sources={sources} onActivateEditor={onActivateEditor} onEditorChange={onEditorChange} onCreateSource={onCreateSource} onSave={onSaveSchedule} onCancel={onCancelSchedule} onRemove={onRemoveSchedule} />
        ))}
        {!branch.itinerary.length && <p className="admin-empty">Nhánh rỗng: nhóm sẽ đi thẳng tới mốc hội nhập.</p>}
      </div>
      {scheduleEditor?.key === newEditorKey ? (
        <ScheduleForm key={newEditorKey} editor={scheduleEditor} busy={busy} error={scheduleError} sources={sources} placement="inline" onChange={onEditorChange} onCreateSource={onCreateSource} onSave={onSaveSchedule} onCancel={onCancelSchedule} />
      ) : (
        <button className="admin-ghost branch-add-activity" type="button" onClick={(event) => onActivateEditor({ ...emptySchedule, branchId: branch.id, editorKey: newEditorKey }, event.currentTarget)} disabled={busy}>Thêm hoạt động vào “{branch.label}”</button>
      )}
    </article>
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
  const typeOptions = includeCurrentOption(ACTIVITY_TYPES, values.type);
  const iconOptions = includeCurrentOption(ACTIVITY_ICONS, values.icon, values.icon);
  const changeType = (event) => {
    const nextType = event.target.value;
    const currentDefaultIcon = ACTIVITY_TYPES.find((option) => option.value === values.type)?.icon;
    const nextDefaultIcon = ACTIVITY_TYPES.find((option) => option.value === nextType)?.icon;
    onChange({
      ...values,
      type: nextType,
      icon: !values.icon || values.icon === currentDefaultIcon ? nextDefaultIcon : values.icon,
    });
  };
  return (
    <form id={`schedule-editor-${editor.key}`} className={`admin-editor admin-form schedule-editor ${placement === "inline" ? "schedule-inline-editor" : "schedule-create-editor"}`} onSubmit={(event) => { event.preventDefault(); onSave(values, values.id); }}>
      <div className="admin-section-head schedule-editor-head">
        <h2 tabIndex="-1" data-editor-heading>{values.id ? `Sửa: ${values.title || "Hoạt động"}` : "Hoạt động mới"}</h2>
        <button type="button" className="admin-ghost" onClick={onCancel} disabled={busy}>Hủy</button>
      </div>
      <div className="form-grid schedule-form-grid">
        <label className="schedule-field schedule-time-field">Bắt đầu<input type="time" {...field("start")} onClick={openTimePicker} required /></label>
        <label className="schedule-field schedule-time-field">Kết thúc<input type="time" {...field("end")} onClick={openTimePicker} required /></label>
        <label className="schedule-field schedule-display-field">Hiển thị kết thúc<input {...field("displayEnd")} placeholder="Tuỳ chọn, ví dụ +" /></label>
        <label className="schedule-field schedule-type-field">Loại
          <select value={values.type || ""} onChange={changeType} required>
            {typeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="schedule-field schedule-icon-field">Icon
          <select {...field("icon")} required>
            {iconOptions.map((option) => <option value={option.value} key={option.value}>{option.value} · {option.label}</option>)}
          </select>
        </label>
        <label className="wide schedule-field schedule-title-field">Tiêu đề<input {...field("title")} required /></label>
        <label className="wide schedule-field schedule-detail-field">Chi tiết<textarea {...field("detail")} rows="3" required /></label>
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
  const keepDraft = useEffectEvent(onKeep);
  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    safeActionRef.current?.focus();
    const handleEscape = (event) => { if (event.key === "Escape") keepDraft(); };
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
