"use client";
import adminShellStyles from "../src/styles/admin-shell.module.css";
import scheduleEditorStyles from "../src/styles/schedule-editor.module.css";

import Button from "./ui/Button";
import { requestJson as api } from "../lib/request-json.mjs";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { ADMIN_ROUTES } from "../lib/admin-routes.mjs";
import { normalizeScheduleRefs } from "../lib/schedule-editor-state.mjs";
import { ActionIcon, TypeIcon } from "./Icons";
import { useScheduleDraft } from "./admin/useScheduleDraft";
import { TripForm, ScheduleForm, SourceForm } from "./admin/EditorForms";
import AdminNav from "./AdminNav";
import ConfirmDialog from "./ConfirmDialog";
import {
  activityInstants,
  calendarDayDifference,
  enumerateTripDays,
  formatDateLabel,
  formatTripDateRange,
} from "../lib/trip-dates.mjs";

const emptyTrip = {
  slug: "",
  title: "",
  startDate: "",
  endDate: "",
  timezone: "Asia/Tokyo",
  location: "",
};
const emptySchedule = {
  startDate: "",
  start: "",
  endDate: "",
  end: "",
  displayEnd: "",
  type: "Visit",
  icon: "📍",
  title: "",
  detail: "",
  refs: [],
};
const TRIP_START_BRANCH_ANCHOR = "trip-start";
const hasTripStarted = (plan) => {
  const firstActivity = plan?.itinerary?.[0];
  if (!firstActivity?.startDate || !firstActivity?.start) return false;
  return (
    Date.now() >=
    activityInstants(firstActivity, plan.trip.timezone).startAt.getTime()
  );
};

const sourceUsageCount = (plan, sourceNumber) =>
  [
    ...(plan?.backbone || plan?.itinerary || []),
    ...(plan?.branchGroups || []).flatMap((group) =>
      group.branches.flatMap((branch) => branch.itinerary),
    ),
  ].filter((item) => item.refs?.includes(sourceNumber)).length;

export default function AdminApp({
  viewer,
  initialTrips,
  initialSelectedSlug,
  initialPlan,
  initialSuggestions,
  pendingInvitationCount = 0,
  pendingTripRequestCount = 0,
}) {
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
      pendingTripRequestCount={pendingTripRequestCount}
    />
  );
}

function Login() {
  return (
    <main
      className={`${adminShellStyles["admin-shell"]} ${scheduleEditorStyles["admin-login-shell"]}`}
    >
      <section className={scheduleEditorStyles["admin-login-card"]}>
        <Link href="/" className={adminShellStyles["admin-back"]}>
          Về lịch
        </Link>
        <h1>Quản lý chuyến đi</h1>
        <p>
          Đăng nhập bằng Google để xem lịch và gửi góp ý. Chỉ chủ lịch mới có
          quyền chỉnh sửa.
        </p>
        <button
          className={scheduleEditorStyles["google-login"]}
          type="button"
          onClick={() => signIn("google", { redirectTo: ADMIN_ROUTES.trips })}
        >
          <GoogleIcon />
          Tiếp tục với Google
        </button>
      </section>
    </main>
  );
}

function ContributorOnly({ user }) {
  return (
    <main
      className={`${adminShellStyles["admin-shell"]} ${scheduleEditorStyles["admin-login-shell"]}`}
    >
      <section className={scheduleEditorStyles["admin-login-card"]}>
        <Link href="/" className={adminShellStyles["admin-back"]}>
          Về lịch
        </Link>
        <h1>Gửi góp ý trên lịch</h1>
        <p>
          <strong>{user.email}</strong> đã đăng nhập. Bạn có thể comment hoặc
          tạo suggestion ở từng mục lịch, nhưng không thể sửa trực tiếp trip
          plan.
        </p>
        <Link
          className={`${scheduleEditorStyles["google-login"]} ${scheduleEditorStyles["contributor-link"]}`}
          href="/"
        >
          Mở lịch để góp ý
        </Link>
        <Button
          variant="ghost"
          className={scheduleEditorStyles["contributor-logout"]}
          type="button"
          onClick={() => signOut({ redirectTo: "/" })}
        >
          Đăng xuất
        </Button>
      </section>
    </main>
  );
}

function Dashboard({
  user,
  initialTrips,
  initialSelectedSlug,
  initialPlan,
  initialSuggestions,
  pendingInvitationCount,
  pendingTripRequestCount,
}) {
  const [trips, setTrips] = useState(initialTrips);
  const [selectedSlug, setSelectedSlug] = useState(initialSelectedSlug);
  const [plan, setPlan] = useState(initialPlan);
  const [tripEditor, setTripEditor] = useState(null);
  const [sourceEditor, setSourceEditor] = useState(null);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [branchCreatorAnchorId, setBranchCreatorAnchorId] = useState(null);
  const [suggestionFilter, setSuggestionFilter] = useState("visible");
  const [suggestionToDelete, setSuggestionToDelete] = useState(null);
  const [suggestionDeleteError, setSuggestionDeleteError] = useState("");
  const {
    editor: scheduleEditor,
    setEditor: setScheduleEditor,
    error: scheduleError,
    setError: setScheduleError,
    activate: activateScheduleEditor,
    close: closeScheduleEditor,
    guard: guardScheduleDraft,
    returnFocusRef: scheduleReturnFocusRef,
    restoreFocus: restoreScheduleFocus,
    discardDialog,
  } = useScheduleDraft(busy);

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
    guardScheduleDraft(
      () => {
        scheduleReturnFocusRef.current = trigger;
        setTripEditor(null);
        setScheduleEditor(null);
        setSourceEditor(null);
        setSelectedSlug(slug);
        setError("");
        setNotice("");
        setScheduleError("");
        refreshPlan(slug).catch((requestError) =>
          setError(requestError.message),
        );
      },
      `Bạn có thay đổi chưa lưu trong “${scheduleEditor?.values.title || "hoạt động hiện tại"}”.`,
    );
  };

  const run = async (action) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const saveTrip = (values, originalSlug) =>
    run(async () => {
      const saved = originalSlug
        ? await api(`/api/trips/${encodeURIComponent(originalSlug)}`, {
            method: "PATCH",
            body: JSON.stringify(values),
          })
        : await api("/api/trips", {
            method: "POST",
            body: JSON.stringify(values),
          });
      setTripEditor(null);
      const nextSlug = await loadTrips(saved.slug);
      await refreshPlan(nextSlug);
    });

  const removeTrip = (slug) => {
    if (!window.confirm(`Xoá trip “${slug}” và toàn bộ schedule?`)) return;
    run(async () => {
      await api(`/api/trips/${encodeURIComponent(slug)}`, { method: "DELETE" });
      setPlan(null);
      setSuggestions([]);
      setSelectedSlug("");
      const nextSlug = await loadTrips();
      await refreshPlan(nextSlug);
    });
  };

  const saveSchedule = async (values, activityId) => {
    setBusy(true);
    setScheduleError("");
    setError("");
    setNotice("");
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
    setNotice(
      activityId ? "Đã lưu thay đổi hoạt động." : "Đã thêm hoạt động mới.",
    );
    try {
      await Promise.all([refreshPlan(selectedSlug), loadTrips(selectedSlug)]);
      restoreScheduleFocus();
    } catch (requestError) {
      setError(
        `Hoạt động đã được lưu nhưng chưa thể tải lại lịch: ${requestError.message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const applyBranchMutation = async (path, options, message) => {
    setBusy(true);
    setError("");
    setNotice("");
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
    if (
      branch &&
      hasTripStarted(plan) &&
      !window.confirm(
        `Chuyến đi đã bắt đầu. Đổi sang “${branch.label}” có thể làm thay đổi hoạt động hiện tại và tiếp theo. Tiếp tục?`,
      )
    ) {
      return Promise.resolve(null);
    }
    return applyBranchMutation(
      `/api/trips/${encodeURIComponent(selectedSlug)}/branches/${groupId}/selection`,
      { method: "PUT", body: JSON.stringify({ branchId }) },
      "Đã đổi phương án đang dùng cho cả nhóm.",
    );
  };

  const addBranchOptionForPlan = (groupId, values) =>
    applyBranchMutation(
      `/api/trips/${encodeURIComponent(selectedSlug)}/branches/${groupId}`,
      { method: "POST", body: JSON.stringify(values) },
      "Đã thêm phương án dự phòng.",
    );

  const updateBranchOptionForPlan = (groupId, branchId, values) =>
    applyBranchMutation(
      `/api/trips/${encodeURIComponent(selectedSlug)}/branches/${groupId}/${branchId}`,
      { method: "PATCH", body: JSON.stringify(values) },
      "Đã lưu thông tin phương án.",
    );

  const deleteBranchOptionForPlan = (groupId, branchId) =>
    applyBranchMutation(
      `/api/trips/${encodeURIComponent(selectedSlug)}/branches/${groupId}/${branchId}`,
      { method: "DELETE" },
      "Đã xoá phương án dự phòng.",
    );

  const unwrapBranchGroupForPlan = (groupId, keepBranchId) =>
    applyBranchMutation(
      `/api/trips/${encodeURIComponent(selectedSlug)}/branches/${groupId}`,
      { method: "DELETE", body: JSON.stringify({ keepBranchId }) },
      "Đã gỡ điểm rẽ và giữ phương án đã chọn trên tuyến chính.",
    );

  const createSourceForPlan = async (values) => {
    const source = await api(
      `/api/trips/${encodeURIComponent(selectedSlug)}/sources`,
      {
        method: "POST",
        body: JSON.stringify(values),
      },
    );
    setPlan((current) =>
      current ? { ...current, sources: [...current.sources, source] } : current,
    );
    return source;
  };

  const saveSource = async (values, sourceNumber = null) => {
    const source =
      sourceNumber == null
        ? await createSourceForPlan(values)
        : await api(
            `/api/trips/${encodeURIComponent(selectedSlug)}/sources/${sourceNumber}`,
            {
              method: "PATCH",
              body: JSON.stringify(values),
            },
          );
    if (sourceNumber != null) {
      setPlan((current) =>
        current
          ? {
              ...current,
              sources: current.sources.map((item) =>
                item.number === source.number ? source : item,
              ),
            }
          : current,
      );
    }
    setSourceEditor(null);
    setNotice(
      sourceNumber == null
        ? `Đã thêm nguồn ${source.number}: ${source.title}`
        : `Đã lưu nguồn ${source.number}: ${source.title}`,
    );
    return source;
  };

  const removeSourceForPlan = (source) => {
    const usageCount = sourceUsageCount(plan, source.number);
    const usageMessage = usageCount
      ? ` Nguồn đang được gắn với ${usageCount} hoạt động và các liên kết đó cũng sẽ được gỡ.`
      : "";
    if (
      !window.confirm(
        `Xoá nguồn ${source.number} “${source.title}”?${usageMessage}`,
      )
    )
      return;
    run(async () => {
      await api(
        `/api/trips/${encodeURIComponent(selectedSlug)}/sources/${source.number}`,
        { method: "DELETE" },
      );
      setSourceEditor(null);
      setScheduleEditor((current) =>
        current
          ? {
              ...current,
              initial: {
                ...current.initial,
                refs: current.initial.refs.filter(
                  (ref) => ref !== source.number,
                ),
              },
              values: {
                ...current.values,
                refs: current.values.refs.filter(
                  (ref) => ref !== source.number,
                ),
              },
            }
          : current,
      );
      await refreshPlan(selectedSlug);
      setNotice(`Đã xoá nguồn ${source.number}: ${source.title}`);
    });
  };

  const removeSchedule = (activityId) => {
    if (!window.confirm("Xoá schedule item này?")) return;
    run(async () => {
      await api(
        `/api/trips/${encodeURIComponent(selectedSlug)}/schedule/${activityId}`,
        { method: "DELETE" },
      );
      await Promise.all([refreshPlan(selectedSlug), loadTrips(selectedSlug)]);
    });
  };

  const updateSuggestion = (suggestionId, status) =>
    run(async () => {
      const updated = await api(
        `/api/trips/${encodeURIComponent(selectedSlug)}/suggestions/${suggestionId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status }),
        },
      );
      setSuggestions((current) =>
        current.map((item) => (item.id === suggestionId ? updated : item)),
      );
    });

  const updateSuggestionVisibility = (suggestion) =>
    run(async () => {
      const updated = await api(
        `/api/trips/${encodeURIComponent(selectedSlug)}/suggestions/${suggestion.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ hidden: !suggestion.hidden }),
        },
      );
      setSuggestions((current) =>
        current.map((item) => (item.id === suggestion.id ? updated : item)),
      );
      setNotice(
        updated.hidden
          ? "Đã ẩn nội dung khỏi lịch công khai."
          : "Đã hiện lại nội dung trên lịch.",
      );
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
      await api(
        `/api/trips/${encodeURIComponent(selectedSlug)}/suggestions/${suggestionToDelete.id}`,
        { method: "DELETE" },
      );
      setSuggestions((current) =>
        current.filter((item) => item.id !== suggestionToDelete.id),
      );
      setSuggestionToDelete(null);
      setNotice("Đã xoá vĩnh viễn nội dung.");
    } catch (requestError) {
      setSuggestionDeleteError(`${requestError.message}. Hãy thử lại.`);
    } finally {
      setBusy(false);
    }
  };

  const logout = () => signOut({ redirectTo: "/" });
  const startBranchGroup =
    plan?.branchGroups?.find((group) => group.anchorActivityId == null) || null;
  const backbone = plan?.backbone || plan?.itinerary || [];
  const occupiedBranchAnchors = new Set(
    (plan?.branchGroups || [])
      .map((group) => group.anchorActivityId)
      .filter(Boolean),
  );
  const firstOccupiedBackboneIndex = backbone.findIndex((activity) =>
    occupiedBranchAnchors.has(activity.id),
  );
  const startBranchBoundary =
    firstOccupiedBackboneIndex >= 0
      ? firstOccupiedBackboneIndex
      : backbone.length - 1;
  const startBranchFollowing = backbone.slice(0, startBranchBoundary + 1);

  return (
    <main className={adminShellStyles["admin-shell"]}>
      <header className={adminShellStyles["admin-header"]}>
        <div>
          <Link href="/" className={adminShellStyles["admin-back"]}>
            Về lịch
          </Link>
          <h1>Quản lý lịch</h1>
          <small className={adminShellStyles["admin-user"]}>
            {user.authMode === "local-dev"
              ? "Local admin · Docker Postgres"
              : user.email}
          </small>
        </div>
        {user.authMode !== "local-dev" && (
          <Button variant="ghost" onClick={logout}>
            Đăng xuất
          </Button>
        )}
      </header>
      {error && (
        <div className={adminShellStyles["admin-alert"]} role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Đóng thông báo">
            <ActionIcon name="close" />
          </button>
        </div>
      )}
      {notice && (
        <div className={adminShellStyles["admin-notice"]} role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="Đóng thông báo">
            <ActionIcon name="close" />
          </button>
        </div>
      )}

      <AdminNav
        tripSlug={selectedSlug}
        active="trips"
        pendingInvitationCount={pendingInvitationCount}
        pendingTripRequestCount={pendingTripRequestCount}
      />

      <div className={adminShellStyles["admin-grid"]}>
        <aside className={adminShellStyles["admin-sidebar"]}>
          <div className={adminShellStyles["admin-section-head"]}>
            <h2>Trip plans</h2>
            <Button
              variant="primary"
              className="small"
              onClick={(event) =>
                guardScheduleDraft(
                  () => {
                    setScheduleEditor(null);
                    setTripEditor({ values: emptyTrip, originalSlug: null });
                  },
                  `Bạn có thay đổi chưa lưu trong “${scheduleEditor?.values.title || "hoạt động hiện tại"}”.`,
                )
              }
            >
              Thêm
            </Button>
          </div>
          <div className={adminShellStyles["trip-list"]}>
            {trips.map((trip) => (
              <button
                className={`${adminShellStyles["trip-list-item"]}${selectedSlug === trip.slug ? " active" : ""}`}
                onClick={(event) => selectTrip(trip.slug, event.currentTarget)}
                disabled={loadingPlan}
                key={trip.slug}
              >
                <strong>{trip.title}</strong>
                <code>{trip.slug}</code>
                <span>
                  {trip.startDate}
                  {trip.endDate !== trip.startDate
                    ? ` → ${trip.endDate}`
                    : ""}{" "}
                  · {trip.scheduleCount} mục
                </span>
              </button>
            ))}
            {!trips.length && (
              <p className={scheduleEditorStyles["admin-empty"]}>
                Chưa có trip.
              </p>
            )}
          </div>
        </aside>

        <section className={adminShellStyles["admin-content"]}>
          {tripEditor && (
            <TripForm
              editor={tripEditor}
              busy={busy}
              onSave={saveTrip}
              onCancel={() => setTripEditor(null)}
            />
          )}
          {!tripEditor && loadingPlan && <PlanSkeleton />}
          {!tripEditor && !loadingPlan && plan && (
            <>
              <div className={scheduleEditorStyles["plan-summary"]}>
                <div>
                  <h2>{plan.trip.title}</h2>
                  <code className={scheduleEditorStyles["plan-slug"]}>
                    {plan.trip.slug}
                  </code>
                  <p>
                    {formatTripDateRange(plan.trip)} · {plan.trip.location} ·{" "}
                    {plan.trip.timezone}
                  </p>
                </div>
                <div className={scheduleEditorStyles["admin-actions"]}>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      guardScheduleDraft(
                        () => {
                          setScheduleEditor(null);
                          setTripEditor({
                            values: plan.trip,
                            originalSlug: plan.trip.slug,
                          });
                        },
                        `Bạn có thay đổi chưa lưu trong “${scheduleEditor?.values.title || "hoạt động hiện tại"}”.`,
                      )
                    }
                  >
                    Sửa trip
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => removeTrip(plan.trip.slug)}
                  >
                    Xoá
                  </Button>
                </div>
              </div>

              <section
                className={scheduleEditorStyles["admin-sources"]}
                aria-labelledby="admin-sources-title"
              >
                <div
                  className={`${adminShellStyles["admin-section-head"]} ${scheduleEditorStyles["source-heading"]}`}
                >
                  <div>
                    <h2 id="admin-sources-title">
                      {plan.sources.length} nguồn địa điểm
                    </h2>
                  </div>
                  <Button
                    variant="primary"
                    type="button"
                    onClick={() =>
                      setSourceEditor((current) =>
                        current ? null : { source: null },
                      )
                    }
                    aria-expanded={Boolean(sourceEditor)}
                  >
                    {sourceEditor ? "Đóng trình sửa" : "Thêm nguồn"}
                  </Button>
                </div>
                {sourceEditor && (
                  <SourceForm
                    key={sourceEditor.source?.number || "new"}
                    source={sourceEditor.source}
                    onSave={(values) =>
                      saveSource(values, sourceEditor.source?.number)
                    }
                    onCancel={() => setSourceEditor(null)}
                  />
                )}
                <div className={scheduleEditorStyles["admin-source-list"]}>
                  {plan.sources.map((source) => (
                    <article
                      className={`${scheduleEditorStyles["admin-source-item"]}${sourceEditor?.source?.number === source.number ? " is-editing" : ""}`}
                      key={source.number}
                    >
                      <span
                        className={scheduleEditorStyles["admin-source-number"]}
                      >
                        {String(source.number).padStart(2, "0")}
                      </span>
                      <a
                        className={scheduleEditorStyles["admin-source-link"]}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span
                          className={scheduleEditorStyles["admin-source-copy"]}
                        >
                          <strong>{source.title}</strong>
                          <small>{source.host}</small>
                        </span>
                        <ActionIcon name="external" />
                      </a>
                      <span
                        className={scheduleEditorStyles["admin-source-actions"]}
                      >
                        <Button
                          variant="ghost"
                          type="button"
                          onClick={() => setSourceEditor({ source })}
                          disabled={busy}
                        >
                          Sửa
                        </Button>
                        <Button
                          variant="danger"
                          type="button"
                          onClick={() => removeSourceForPlan(source)}
                          disabled={busy}
                        >
                          Xoá
                        </Button>
                      </span>
                    </article>
                  ))}
                  {!plan.sources.length && (
                    <p className={scheduleEditorStyles["admin-empty"]}>
                      Chưa có nguồn. Thêm nguồn đầu tiên để gắn vào hoạt động.
                    </p>
                  )}
                </div>
              </section>

              <div
                className={`${adminShellStyles["admin-section-head"]} ${scheduleEditorStyles["schedule-heading"]}`}
              >
                <div>
                  <h2>{plan.itinerary.length} hoạt động đang dùng</h2>
                  <p>{plan.branchGroups?.length || 0} điểm rẽ</p>
                </div>
                <div
                  className={scheduleEditorStyles["schedule-heading-actions"]}
                >
                  {!startBranchGroup && startBranchFollowing.length > 1 && (
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={busy}
                      aria-expanded={
                        branchCreatorAnchorId === TRIP_START_BRANCH_ANCHOR
                      }
                      onClick={() =>
                        setBranchCreatorAnchorId((current) =>
                          current === TRIP_START_BRANCH_ANCHOR
                            ? null
                            : TRIP_START_BRANCH_ANCHOR,
                        )
                      }
                    >
                      Tạo điểm rẽ từ đầu
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    disabled={busy}
                    aria-expanded={scheduleEditor?.key === "new"}
                    aria-controls="schedule-editor-new"
                    onClick={(event) =>
                      activateScheduleEditor(
                        {
                          ...emptySchedule,
                          startDate: plan.trip.startDate,
                          endDate: plan.trip.startDate,
                        },
                        event.currentTarget,
                      )
                    }
                  >
                    Thêm hoạt động
                  </Button>
                </div>
              </div>
              <div
                className={scheduleEditorStyles["admin-day-rail"]}
                aria-label="Các ngày trong chuyến đi"
              >
                {enumerateTripDays(plan.trip.startDate, plan.trip.endDate).map(
                  (date, index) => {
                    const count = backbone.filter(
                      (item) => item.startDate === date,
                    ).length;
                    return (
                      <button
                        type="button"
                        key={date}
                        onClick={(event) =>
                          activateScheduleEditor(
                            {
                              ...emptySchedule,
                              startDate: date,
                              endDate: date,
                            },
                            event.currentTarget,
                          )
                        }
                        disabled={busy}
                      >
                        <span>Ngày {index + 1}</span>
                        <strong>
                          {formatDateLabel(date, plan.trip.timezone, {
                            weekday: "short",
                            day: "2-digit",
                            month: "2-digit",
                          })}
                        </strong>
                        <small>
                          {count ? `${count} hoạt động` : "Thêm hoạt động"}
                        </small>
                      </button>
                    );
                  },
                )}
              </div>
              {scheduleEditor?.key === "new" && (
                <ScheduleForm
                  key="new"
                  editor={scheduleEditor}
                  busy={busy}
                  error={scheduleError}
                  sources={plan.sources}
                  placement="create"
                  onChange={(values) =>
                    setScheduleEditor((current) =>
                      current ? { ...current, values } : current,
                    )
                  }
                  onCreateSource={createSourceForPlan}
                  onSave={saveSchedule}
                  onCancel={closeScheduleEditor}
                />
              )}
              {branchCreatorAnchorId === TRIP_START_BRANCH_ANCHOR && (
                <BranchCreateForm
                  anchor={null}
                  following={startBranchFollowing}
                  busy={busy}
                  onCancel={() => setBranchCreatorAnchorId(null)}
                  onSave={createBranchGroupForPlan}
                />
              )}
              {startBranchGroup && (
                <div
                  className={scheduleEditorStyles["admin-trip-start-junction"]}
                >
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
                    onEditorChange={(values) =>
                      setScheduleEditor((current) =>
                        current ? { ...current, values } : current,
                      )
                    }
                    onCreateSource={createSourceForPlan}
                    onSaveSchedule={saveSchedule}
                    onCancelSchedule={closeScheduleEditor}
                    onRemoveSchedule={removeSchedule}
                  />
                </div>
              )}
              <div className={scheduleEditorStyles["admin-schedule-list"]}>
                {backbone.map((item, itemIndex, backboneItems) => {
                  const group = plan.branchGroups?.find(
                    (candidate) => candidate.anchorActivityId === item.id,
                  );
                  const beginsDay =
                    itemIndex === 0 ||
                    backboneItems[itemIndex - 1].startDate !== item.startDate;
                  return (
                    <div
                      className={scheduleEditorStyles["admin-route-segment"]}
                      key={item.id}
                    >
                      {beginsDay && (
                        <div
                          className={scheduleEditorStyles["admin-day-divider"]}
                        >
                          <div>
                            <span>
                              Ngày{" "}
                              {calendarDayDifference(
                                plan.trip.startDate,
                                item.startDate,
                              ) + 1}
                            </span>
                            <h3>
                              {formatDateLabel(
                                item.startDate,
                                plan.trip.timezone,
                                {
                                  weekday: "long",
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                },
                              )}
                            </h3>
                          </div>
                          <Button
                            variant="ghost"
                            type="button"
                            disabled={busy}
                            onClick={(event) =>
                              activateScheduleEditor(
                                {
                                  ...emptySchedule,
                                  startDate: item.startDate,
                                  endDate: item.startDate,
                                },
                                event.currentTarget,
                              )
                            }
                          >
                            Thêm vào ngày này
                          </Button>
                        </div>
                      )}
                      <ScheduleRow
                        item={item}
                        busy={busy}
                        scheduleEditor={scheduleEditor}
                        scheduleError={scheduleError}
                        sources={plan.sources}
                        onActivateEditor={activateScheduleEditor}
                        onEditorChange={(values) =>
                          setScheduleEditor((current) =>
                            current ? { ...current, values } : current,
                          )
                        }
                        onCreateSource={createSourceForPlan}
                        onSave={saveSchedule}
                        onCancel={closeScheduleEditor}
                        onRemove={removeSchedule}
                      />
                      {!group && itemIndex < backboneItems.length - 1 && (
                        <div
                          className={scheduleEditorStyles["admin-branch-entry"]}
                        >
                          <Button
                            variant="ghost"
                            type="button"
                            disabled={busy}
                            aria-expanded={branchCreatorAnchorId === item.id}
                            onClick={() =>
                              setBranchCreatorAnchorId((current) =>
                                current === item.id ? null : item.id,
                              )
                            }
                          >
                            Tạo điểm rẽ sau mục này
                          </Button>
                        </div>
                      )}
                      {branchCreatorAnchorId === item.id && (
                        <BranchCreateForm
                          anchor={item}
                          following={backboneItems.slice(itemIndex + 1)}
                          busy={busy}
                          onCancel={() => setBranchCreatorAnchorId(null)}
                          onSave={createBranchGroupForPlan}
                        />
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
                          onEditorChange={(values) =>
                            setScheduleEditor((current) =>
                              current ? { ...current, values } : current,
                            )
                          }
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

              <div
                className={`${adminShellStyles["admin-section-head"]} ${scheduleEditorStyles["suggestion-admin-heading"]}`}
              >
                <div>
                  <h2>{suggestions.length} góp ý</h2>
                  <p>Quản lý trạng thái và mức hiển thị trên lịch công khai.</p>
                </div>
                <div
                  className={scheduleEditorStyles["admin-suggestion-filters"]}
                  role="group"
                  aria-label="Lọc góp ý theo hiển thị"
                >
                  <button
                    type="button"
                    aria-pressed={suggestionFilter === "visible"}
                    onClick={() => setSuggestionFilter("visible")}
                  >
                    Đang hiện{" "}
                    <span>
                      {suggestions.filter((item) => !item.hidden).length}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={suggestionFilter === "hidden"}
                    onClick={() => setSuggestionFilter("hidden")}
                  >
                    Đã ẩn{" "}
                    <span>
                      {suggestions.filter((item) => item.hidden).length}
                    </span>
                  </button>
                </div>
              </div>
              <div className={scheduleEditorStyles["admin-suggestion-list"]}>
                {suggestions
                  .filter((suggestion) =>
                    suggestionFilter === "hidden"
                      ? suggestion.hidden
                      : !suggestion.hidden,
                  )
                  .map((suggestion) => {
                    const activity = [
                      ...(plan.backbone || plan.itinerary),
                      ...(plan.branchGroups || []).flatMap((group) =>
                        group.branches.flatMap((branch) => branch.itinerary),
                      ),
                    ].find((item) => item.id === suggestion.activityId);
                    return (
                      <article
                        className={`${scheduleEditorStyles["admin-suggestion-item"]}${suggestion.hidden ? " is-hidden" : ""}`}
                        key={suggestion.id}
                      >
                        <div
                          className={
                            scheduleEditorStyles["admin-suggestion-meta"]
                          }
                        >
                          <span>
                            {suggestion.kind === "comment"
                              ? "Bình luận"
                              : "Đề xuất"}
                          </span>
                          <strong>{suggestion.author.name}</strong>
                          <small>{suggestion.author.email}</small>
                          {suggestion.hidden && <em>Đã ẩn</em>}
                        </div>
                        <div
                          className={
                            scheduleEditorStyles["admin-suggestion-copy"]
                          }
                        >
                          <small>
                            {activity
                              ? `${activity.start} · ${activity.title}`
                              : "Góp ý chung cho chuyến đi"}
                          </small>
                          <p>{suggestion.body}</p>
                        </div>
                        <div
                          className={
                            scheduleEditorStyles["admin-suggestion-controls"]
                          }
                        >
                          <select
                            value={suggestion.status}
                            onChange={(event) =>
                              updateSuggestion(
                                suggestion.id,
                                event.target.value,
                              )
                            }
                            disabled={busy}
                            aria-label="Trạng thái góp ý"
                          >
                            <option value="open">Mới</option>
                            <option value="accepted">Đã nhận</option>
                            <option value="resolved">Đã xử lý</option>
                            <option value="rejected">Từ chối</option>
                          </select>
                          <Button
                            variant="ghost"
                            type="button"
                            onClick={() =>
                              updateSuggestionVisibility(suggestion)
                            }
                            disabled={busy}
                          >
                            {suggestion.hidden ? "Hiện lại" : "Ẩn"}
                          </Button>
                          <AdminSuggestionMenu
                            suggestion={suggestion}
                            busy={busy}
                            onDelete={requestRemoveSuggestion}
                          />
                        </div>
                      </article>
                    );
                  })}
                {!suggestions.length && (
                  <p className={scheduleEditorStyles["admin-empty"]}>
                    Chưa có góp ý nào.
                  </p>
                )}
                {suggestions.length > 0 &&
                  !suggestions.some((suggestion) =>
                    suggestionFilter === "hidden"
                      ? suggestion.hidden
                      : !suggestion.hidden,
                  ) && (
                    <p className={scheduleEditorStyles["admin-empty"]}>
                      {suggestionFilter === "hidden"
                        ? "Chưa có nội dung nào bị ẩn."
                        : "Không còn nội dung đang hiển thị."}
                    </p>
                  )}
              </div>
            </>
          )}
          {!tripEditor && !loadingPlan && !plan && (
            <div
              className={`${scheduleEditorStyles["admin-empty"]} ${scheduleEditorStyles["large"]}`}
            >
              Chọn hoặc tạo một trip plan.
            </div>
          )}
        </section>
      </div>
      {discardDialog}
      {suggestionToDelete && (
        <ConfirmDialog
          title="Xoá vĩnh viễn nội dung này?"
          description={`Nội dung của ${suggestionToDelete.author.name} sẽ biến mất và không thể khôi phục.`}
          preview={suggestionToDelete.body}
          confirmLabel="Xoá vĩnh viễn"
          pendingLabel="Đang xoá…"
          pending={busy}
          error={suggestionDeleteError}
          onCancel={() => {
            setSuggestionToDelete(null);
            setSuggestionDeleteError("");
          }}
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
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
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
    <div
      className={scheduleEditorStyles["admin-suggestion-menu"]}
      ref={rootRef}
    >
      <Button
        variant="ghost"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        disabled={busy}
        ref={triggerRef}
      >
        Thêm
      </Button>
      {open && (
        <div>
          <Button
            variant="danger"
            type="button"
            onClick={() => onDelete(suggestion)}
          >
            Xoá vĩnh viễn
          </Button>
        </div>
      )}
    </div>
  );
}

function ScheduleRow({
  item,
  busy,
  scheduleEditor,
  scheduleError,
  sources,
  onActivateEditor,
  onEditorChange,
  onCreateSource,
  onSave,
  onCancel,
  onRemove,
}) {
  const editorId = `schedule-editor-${item.id}`;
  const isEditing = scheduleEditor?.key === String(item.id);
  return (
    <article
      className={`${scheduleEditorStyles["admin-schedule-item"]}${isEditing ? " is-editing" : ""}`}
    >
      <div className={scheduleEditorStyles["admin-schedule-time"]}>
        <small>{item.startDate}</small>
        <strong>{item.start}</strong>
        <span>
          {item.displayEnd || item.end}
          {item.endDate !== item.startDate ? " · +1 ngày" : ""}
        </span>
      </div>
      <div className={scheduleEditorStyles["admin-schedule-copy"]}>
        <span>
          <TypeIcon type={item.type} /> {item.type}
        </span>
        <h3>{item.title}</h3>
        {item.detail && <p>{item.detail}</p>}
      </div>
      <div className={scheduleEditorStyles["admin-row-actions"]}>
        <Button
          variant="ghost"
          disabled={busy}
          aria-expanded={isEditing}
          aria-controls={editorId}
          onClick={(event) => onActivateEditor(item, event.currentTarget)}
        >
          {isEditing ? "Đang sửa" : "Sửa"}
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => onRemove(item.id)}
        >
          Xoá
        </Button>
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
  const field = (name) => ({
    value: values[name],
    onChange: (event) =>
      setValues((current) => ({ ...current, [name]: event.target.value })),
  });
  const submit = (event) => {
    event.preventDefault();
    onSave({
      anchorActivityId: anchor?.id ?? null,
      segmentActivityIds: following
        .slice(0, segmentCount)
        .map((item) => item.id),
      title: values.title,
      defaultBranch: {
        label: values.defaultLabel,
        condition: values.defaultCondition,
      },
      alternateBranch: {
        label: values.alternateLabel,
        condition: values.alternateCondition,
      },
    });
  };
  return (
    <form
      className={`${scheduleEditorStyles["admin-editor"]} ${scheduleEditorStyles["branch-create-editor"]}${startsTrip ? " is-trip-start" : ""}`}
      onSubmit={submit}
    >
      <div className={adminShellStyles["admin-section-head"]}>
        <div>
          <h2>
            {startsTrip
              ? "Tạo điểm rẽ từ đầu chuyến"
              : `Tạo điểm rẽ sau “${anchor.title}”`}
          </h2>
          <p>
            {startsTrip
              ? "Các hoạt động đầu tiên sẽ trở thành phương án mặc định; mọi tuyến hội nhập lại trước một hoạt động chung."
              : "Đoạn hiện có sẽ trở thành phương án mặc định."}
          </p>
        </div>
        <Button variant="ghost" type="button" onClick={onCancel}>
          Hủy
        </Button>
      </div>
      <div className={scheduleEditorStyles["form-grid"]}>
        <label className="wide">
          Tên điểm rẽ
          <input {...field("title")} required />
        </label>
        <label className="wide">
          Hội nhập lại
          <select
            value={segmentCount}
            onChange={(event) => setSegmentCount(Number(event.target.value))}
          >
            {selectableActivities.map((item, index) => (
              <option value={index + 1} key={item.id}>
                {index + 1 < following.length
                  ? `Trước ${following[index + 1].start} · ${following[index + 1].title}`
                  : "Cuối chuyến"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tên phương án mặc định
          <input {...field("defaultLabel")} required />
        </label>
        <label>
          Điều kiện
          <input {...field("defaultCondition")} required />
        </label>
        <label>
          Tên phương án dự phòng
          <input {...field("alternateLabel")} required />
        </label>
        <label>
          Điều kiện
          <input {...field("alternateCondition")} required />
        </label>
      </div>
      <div className={scheduleEditorStyles["schedule-editor-actions"]}>
        <Button variant="ghost" type="button" onClick={onCancel}>
          Hủy
        </Button>
        <Button variant="primary" disabled={busy}>
          {busy
            ? "Đang tạo…"
            : `Chuyển ${segmentCount} hoạt động ${startsTrip ? "đầu tiên " : ""}thành điểm rẽ`}
        </Button>
      </div>
    </form>
  );
}

function BranchGroupAdmin({
  group,
  startsTrip = false,
  busy,
  scheduleEditor,
  scheduleError,
  sources,
  onActivate,
  onAddOption,
  onUpdateOption,
  onDeleteOption,
  onUnwrap,
  onActivateEditor,
  onEditorChange,
  onCreateSource,
  onSaveSchedule,
  onCancelSchedule,
  onRemoveSchedule,
}) {
  const [adding, setAdding] = useState(false);
  const [newBranch, setNewBranch] = useState({ label: "", condition: "" });
  const [keepBranchId, setKeepBranchId] = useState(group.selectedBranchId);
  const selected =
    group.branches.find((branch) => branch.id === group.selectedBranchId) ||
    group.branches[0];
  const unwrap = () => {
    if (
      !window.confirm(
        `Gỡ điểm rẽ và giữ “${group.branches.find((branch) => branch.id === keepBranchId)?.label}” trên tuyến chính? Các activity ở phương án khác sẽ bị xoá.`,
      )
    )
      return;
    onUnwrap(group.id, keepBranchId);
  };
  return (
    <section
      className={`${scheduleEditorStyles["admin-branch-group"]}${startsTrip ? " is-trip-start" : ""}`}
      aria-labelledby={`branch-group-${group.id}`}
    >
      <div className={scheduleEditorStyles["admin-branch-head"]}>
        <div>
          <span>
            {startsTrip ? "Điểm rẽ đầu chuyến" : "Điểm rẽ"} ·{" "}
            {group.branches.length} phương án
          </span>
          <h3 id={`branch-group-${group.id}`}>{group.title}</h3>
          <p>
            Đang dùng: <strong>{selected.label}</strong> · {selected.condition}
          </p>
        </div>
        <Button
          variant="ghost"
          type="button"
          onClick={() => setAdding((current) => !current)}
          disabled={busy}
        >
          {adding ? "Hủy thêm" : "Thêm phương án"}
        </Button>
      </div>
      {adding && (
        <form
          className={scheduleEditorStyles["branch-option-add"]}
          onSubmit={(event) => {
            event.preventDefault();
            onAddOption(group.id, newBranch).then((plan) => {
              if (plan) {
                setAdding(false);
                setNewBranch({ label: "", condition: "" });
              }
            });
          }}
        >
          <label>
            Tên phương án
            <input
              value={newBranch.label}
              onChange={(event) =>
                setNewBranch({ ...newBranch, label: event.target.value })
              }
              required
            />
          </label>
          <label>
            Điều kiện
            <input
              value={newBranch.condition}
              onChange={(event) =>
                setNewBranch({ ...newBranch, condition: event.target.value })
              }
              required
            />
          </label>
          <Button variant="primary" disabled={busy}>
            Thêm phương án
          </Button>
        </form>
      )}
      <div className={scheduleEditorStyles["admin-branch-options"]}>
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
      <div className={scheduleEditorStyles["admin-branch-unwrap"]}>
        <label>
          Giữ lại khi gỡ
          <select
            value={keepBranchId}
            onChange={(event) => setKeepBranchId(event.target.value)}
          >
            {group.branches.map((branch) => (
              <option value={branch.id} key={branch.id}>
                {branch.label}
              </option>
            ))}
          </select>
        </label>
        <Button variant="danger" type="button" onClick={unwrap} disabled={busy}>
          Gỡ điểm rẽ
        </Button>
      </div>
    </section>
  );
}

function BranchOptionAdmin({
  group,
  branch,
  selected,
  busy,
  scheduleEditor,
  scheduleError,
  sources,
  onActivate,
  onUpdate,
  onDelete,
  onActivateEditor,
  onEditorChange,
  onCreateSource,
  onSaveSchedule,
  onCancelSchedule,
  onRemoveSchedule,
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({
    label: branch.label,
    condition: branch.condition,
  });
  const newEditorKey = `new-branch-${branch.id}`;
  const branchDefaultDate =
    branch.itinerary.at(-1)?.endDate ||
    group.branches.flatMap((option) => option.itinerary)[0]?.startDate ||
    "";
  return (
    <article
      className={`${scheduleEditorStyles["admin-branch-option"]}${selected ? " is-selected" : ""}`}
    >
      <div className={scheduleEditorStyles["admin-branch-option-head"]}>
        <div>
          <span>
            {selected ? "Đang dùng" : "Dự phòng"}
            {branch.isDefault ? " · Mặc định" : ""}
          </span>
          <h4>{branch.label}</h4>
          <p>{branch.condition}</p>
        </div>
        <div className={scheduleEditorStyles["admin-row-actions"]}>
          {!selected && (
            <Button
              variant="primary"
              className="small"
              type="button"
              onClick={() => onActivate(group.id, branch.id)}
              disabled={busy}
            >
              Dùng phương án này
            </Button>
          )}
          <Button
            variant="ghost"
            type="button"
            onClick={() => setEditing((current) => !current)}
            disabled={busy}
          >
            Sửa nhãn
          </Button>
          {!selected && !branch.isDefault && group.branches.length > 2 && (
            <Button
              variant="danger"
              type="button"
              onClick={() => {
                if (window.confirm(`Xoá phương án “${branch.label}”?`))
                  onDelete(group.id, branch.id);
              }}
              disabled={busy}
            >
              Xoá
            </Button>
          )}
        </div>
      </div>
      {editing && (
        <form
          className={scheduleEditorStyles["branch-option-edit"]}
          onSubmit={(event) => {
            event.preventDefault();
            onUpdate(group.id, branch.id, values).then((plan) => {
              if (plan) setEditing(false);
            });
          }}
        >
          <label>
            Tên
            <input
              value={values.label}
              onChange={(event) =>
                setValues({ ...values, label: event.target.value })
              }
              required
            />
          </label>
          <label>
            Điều kiện
            <input
              value={values.condition}
              onChange={(event) =>
                setValues({ ...values, condition: event.target.value })
              }
              required
            />
          </label>
          <Button variant="primary" disabled={busy}>
            Lưu nhãn
          </Button>
        </form>
      )}
      <div className={scheduleEditorStyles["admin-branch-activities"]}>
        {branch.itinerary.map((item) => (
          <ScheduleRow
            key={item.id}
            item={item}
            busy={busy}
            scheduleEditor={scheduleEditor}
            scheduleError={scheduleError}
            sources={sources}
            onActivateEditor={onActivateEditor}
            onEditorChange={onEditorChange}
            onCreateSource={onCreateSource}
            onSave={onSaveSchedule}
            onCancel={onCancelSchedule}
            onRemove={onRemoveSchedule}
          />
        ))}
        {!branch.itinerary.length && (
          <p className={scheduleEditorStyles["admin-empty"]}>
            Nhánh rỗng: nhóm sẽ đi thẳng tới mốc hội nhập.
          </p>
        )}
      </div>
      {scheduleEditor?.key === newEditorKey ? (
        <ScheduleForm
          key={newEditorKey}
          editor={scheduleEditor}
          busy={busy}
          error={scheduleError}
          sources={sources}
          placement="inline"
          onChange={onEditorChange}
          onCreateSource={onCreateSource}
          onSave={onSaveSchedule}
          onCancel={onCancelSchedule}
        />
      ) : (
        <Button
          id={`schedule-trigger-${newEditorKey}`}
          variant="ghost"
          className={scheduleEditorStyles["branch-add-activity"]}
          type="button"
          onClick={(event) =>
            onActivateEditor(
              {
                ...emptySchedule,
                startDate: branchDefaultDate,
                endDate: branchDefaultDate,
                branchId: branch.id,
                editorKey: newEditorKey,
              },
              event.currentTarget,
            )
          }
          disabled={busy}
        >
          Thêm hoạt động vào “{branch.label}”
        </Button>
      )}
    </article>
  );
}

function PlanSkeleton() {
  return (
    <div
      className={scheduleEditorStyles["admin-plan-skeleton"]}
      aria-live="polite"
      aria-label="Đang tải trip plan"
    >
      <span />
      <strong />
      <span />
      <div>
        {[0, 1, 2, 3].map((item) => (
          <span key={item} />
        ))}
      </div>
    </div>
  );
}

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
