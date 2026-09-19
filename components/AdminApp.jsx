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
import { PlaceForm, TripForm, ScheduleForm, SourceForm } from "./admin/EditorForms";
import AdminNav from "./AdminNav";
import ConfirmDialog from "./ConfirmDialog";
import LanguageSwitcher from "./LanguageSwitcher";
import ShareTripButton from "./ShareTripButton";
import InvitationDialog from "./InvitationDialog";
import { useLocale } from "./LocaleProvider";
import { adminErrorMessage } from "../lib/i18n-admin.mjs";
import { translateActivityType } from "../lib/i18n.mjs";
import { ActivityExpenses, ExpenseSummary, useExpenseLedger } from "./tracker/Expenses";
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
  currency: "JPY",
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
  reservationContacts: [],
  refs: [],
};
const TRIP_START_BRANCH_ANCHOR = "trip-start";
const pushSelectedTripUrl = (slug) => {
  const url = new URL(window.location.href);
  url.searchParams.set("trip", slug);
  url.searchParams.delete("create");
  window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
};

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

const placeUsageCount = (plan, placeId) =>
  [
    ...(plan?.backbone || plan?.itinerary || []),
    ...(plan?.branchGroups || []).flatMap((group) =>
      group.branches.flatMap((branch) => branch.itinerary),
    ),
  ].filter((item) => item.placeId === placeId).length;

export default function AdminApp({
  scope = "admin",
  viewer,
  initialTrips,
  initialSelectedSlug,
  initialPlan,
  initialSuggestions,
  pendingInvitationCount = 0,
  pendingTripRequestCount = 0,
  initialCreateOpen = false,
}) {
  if (!viewer?.email) return <Login scope={scope} />;
  if (scope === "admin" && !viewer.isAdmin) return <ContributorOnly user={viewer} />;
  return (
    <Dashboard
      scope={scope}
      user={viewer}
      initialTrips={initialTrips}
      initialSelectedSlug={initialSelectedSlug}
      initialPlan={initialPlan}
      initialSuggestions={initialSuggestions}
      pendingInvitationCount={pendingInvitationCount}
      pendingTripRequestCount={pendingTripRequestCount}
      initialCreateOpen={initialCreateOpen}
    />
  );
}

function Login({ scope }) {
  const { t } = useLocale();
  return (
    <main
      className={`${adminShellStyles["admin-shell"]} ${scheduleEditorStyles["admin-login-shell"]}`}
    >
      <section className={scheduleEditorStyles["admin-login-card"]}>
        <LanguageSwitcher />
        <Link href="/" className={adminShellStyles["admin-back"]}>
          {t("common.backToSchedule")}
        </Link>
        <h1>{t("admin.loginTitle")}</h1>
        <p>{t("admin.loginDescription")}</p>
        <button
          className={scheduleEditorStyles["google-login"]}
          type="button"
          onClick={() => signIn("google", { redirectTo: scope === "personal" ? "/trips/manage" : ADMIN_ROUTES.trips })}
        >
          <GoogleIcon />
          {t("common.loginGoogle")}
        </button>
      </section>
    </main>
  );
}

function ContributorOnly({ user }) {
  const { t } = useLocale();
  return (
    <main
      className={`${adminShellStyles["admin-shell"]} ${scheduleEditorStyles["admin-login-shell"]}`}
    >
      <section className={scheduleEditorStyles["admin-login-card"]}>
        <LanguageSwitcher />
        <Link href="/" className={adminShellStyles["admin-back"]}>
          {t("common.backToSchedule")}
        </Link>
        <h1>{t("admin.contributorTitle")}</h1>
        <p>
          <strong>{user.email}</strong> {t("adminExtra.message001")}
        </p>
        <Link
          className={`${scheduleEditorStyles["google-login"]} ${scheduleEditorStyles["contributor-link"]}`}
          href="/"
        >
          {t("admin.openScheduleFeedback")}
        </Link>
        <Button
          variant="ghost"
          className={scheduleEditorStyles["contributor-logout"]}
          type="button"
          onClick={() => signOut({ redirectTo: "/" })}
        >
          {t("adminExtra.message002")}
        </Button>
      </section>
    </main>
  );
}

function Dashboard({
  scope,
  user,
  initialTrips,
  initialSelectedSlug,
  initialPlan,
  initialSuggestions,
  pendingInvitationCount,
  pendingTripRequestCount,
  initialCreateOpen,
}) {
  const { t, intlLocale, locale } = useLocale();
  const [trips, setTrips] = useState(initialTrips);
  const [selectedSlug, setSelectedSlug] = useState(initialSelectedSlug);
  const [plan, setPlan] = useState(initialPlan);
  const [tripEditor, setTripEditor] = useState(initialCreateOpen ? { values: { ...emptyTrip, memberEmails: [] }, originalSlug: null } : null);
  const [sourceEditor, setSourceEditor] = useState(null);
  const [placeEditor, setPlaceEditor] = useState(null);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [branchCreatorAnchorId, setBranchCreatorAnchorId] = useState(null);
  const [suggestionFilter, setSuggestionFilter] = useState("visible");
  const [suggestionToDelete, setSuggestionToDelete] = useState(null);
  const [suggestionDeleteError, setSuggestionDeleteError] = useState("");
  const [members, setMembers] = useState([]);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberError, setMemberError] = useState("");
  const [memberBusy, setMemberBusy] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState("plan");
  const [auditEvents, setAuditEvents] = useState([]);
  const [ownershipFilter, setOwnershipFilter] = useState("all");
  const [invitationOpen, setInvitationOpen] = useState(false);
  const expenseLedger = useExpenseLedger(selectedSlug);
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

  const loadTrips = useCallback(async (preferredSlug, nextOwnership = ownershipFilter) => {
    const data = await api(scope === "admin" ? `/api/admin/trips?ownership=${nextOwnership}` : "/api/trips");
    const nextTrips = scope === "personal" ? data.trips.filter((trip) => trip.membershipRole === "leader") : data.trips;
    setTrips(nextTrips);
    const nextSlug = preferredSlug || nextTrips[0]?.slug || "";
    setSelectedSlug(nextSlug);
    return nextSlug;
  }, [scope, ownershipFilter]);

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

  const loadMembers = useCallback(async (slug) => {
    if (!slug) return;
    const data = await api(`/api/trips/${encodeURIComponent(slug)}/members`);
    setMembers(data.members);
  }, []);

  useEffect(() => {
    if (!selectedSlug) return;
    api(`/api/trips/${encodeURIComponent(selectedSlug)}/members`)
      .then((data) => setMembers(data.members))
      .catch((requestError) => setMemberError(adminErrorMessage(requestError, t, locale)));
  }, [selectedSlug, loadMembers, locale, t]);

  useEffect(() => {
    if (scope !== "admin" || workspaceTab !== "activity" || !selectedSlug) return;
    api(`/api/admin/trips/${encodeURIComponent(selectedSlug)}/audit`)
      .then((data) => setAuditEvents(data.events))
      .catch((requestError) => setError(adminErrorMessage(requestError, t, locale)));
  }, [scope, workspaceTab, selectedSlug, locale, t]);

  const selectTrip = (slug, trigger) => {
    if (slug === selectedSlug || loadingPlan) return;
    guardScheduleDraft(
      () => {
        scheduleReturnFocusRef.current = trigger;
        setTripEditor(null);
        setScheduleEditor(null);
        setSourceEditor(null);
        setPlaceEditor(null);
        setSelectedSlug(slug);
        pushSelectedTripUrl(slug);
        setError("");
        setNotice("");
        setScheduleError("");
        refreshPlan(slug).catch((requestError) =>
          setError(adminErrorMessage(requestError, t, locale)),
        );
      },
      t("adminExtra.message003", {
        value0: scheduleEditor?.values.title || t("adminExtra.message004"),
      }),
    );
  };

  const run = async (action) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (requestError) {
      setError(adminErrorMessage(requestError, t, locale));
    } finally {
      setBusy(false);
    }
  };

  const addMember = async (event) => {
    event.preventDefault();
    setMemberBusy(true); setMemberError("");
    try {
      await api(`/api/trips/${encodeURIComponent(selectedSlug)}/members`, {
        method: "POST", body: JSON.stringify({ email: memberEmail }),
      });
      setMemberEmail("");
      await Promise.all([loadMembers(selectedSlug), loadTrips(selectedSlug)]);
      setNotice(t("visibility.memberAdded"));
    } catch (requestError) { setMemberError(adminErrorMessage(requestError, t, locale)); }
    finally { setMemberBusy(false); }
  };

  const removeMember = async (email) => {
    if (!window.confirm(t("visibility.removeMemberConfirm", { email }))) return;
    setMemberBusy(true); setMemberError("");
    try {
      await api(`/api/trips/${encodeURIComponent(selectedSlug)}/members/${encodeURIComponent(email)}`, { method: "DELETE" });
      await Promise.all([loadMembers(selectedSlug), loadTrips(selectedSlug)]);
      setNotice(t("visibility.memberRemoved"));
    } catch (requestError) { setMemberError(adminErrorMessage(requestError, t, locale)); }
    finally { setMemberBusy(false); }
  };

  const transferLeader = async (email) => {
    if (!window.confirm(t("visibility.transferConfirm", { email }))) return;
    setMemberBusy(true); setMemberError("");
    try {
      await api(`/api/trips/${encodeURIComponent(selectedSlug)}/members/${encodeURIComponent(email)}/leader`, { method: "PUT" });
      if (scope === "personal") {
        setPlan(null); setSelectedSlug("");
        const nextSlug = await loadTrips();
        await refreshPlan(nextSlug);
      } else {
        await Promise.all([loadMembers(selectedSlug), loadTrips(selectedSlug)]);
      }
      setNotice(t("visibility.leaderTransferred"));
    } catch (requestError) { setMemberError(adminErrorMessage(requestError, t, locale)); }
    finally { setMemberBusy(false); }
  };

  const setMemberExpensePermission = async (email, canManageExpenses) => {
    setMemberBusy(true); setMemberError("");
    try {
      await api(`/api/trips/${encodeURIComponent(selectedSlug)}/members/${encodeURIComponent(email)}/expense-permission`, {
        method: "PUT", body: JSON.stringify({ canManageExpenses }),
      });
      await Promise.all([loadMembers(selectedSlug), expenseLedger.refresh()]);
    } catch (requestError) { setMemberError(adminErrorMessage(requestError, t, locale)); }
    finally { setMemberBusy(false); }
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
    if (!window.confirm(t("adminExtra.message005", { value0: slug }))) return;
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
      setScheduleError(adminErrorMessage(requestError, t, locale));
      setBusy(false);
      return;
    }
    setScheduleEditor(null);
    setNotice(
      activityId ? t("adminExtra.message006") : t("adminExtra.message007"),
    );
    try {
      await Promise.all([refreshPlan(selectedSlug), loadTrips(selectedSlug)]);
      restoreScheduleFocus();
    } catch (requestError) {
      setError(
        t("adminExtra.message008", {
          value0: adminErrorMessage(requestError, t, locale),
        }),
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
      setError(adminErrorMessage(requestError, t, locale));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const createBranchGroupForPlan = async (values) => {
    const nextPlan = await applyBranchMutation(
      `/api/trips/${encodeURIComponent(selectedSlug)}/branches`,
      { method: "POST", body: JSON.stringify(values) },
      t("adminExtra.message009"),
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
      !window.confirm(t("adminExtra.message010", { value0: branch.label }))
    ) {
      return Promise.resolve(null);
    }
    return applyBranchMutation(
      `/api/trips/${encodeURIComponent(selectedSlug)}/branches/${groupId}/selection`,
      { method: "PUT", body: JSON.stringify({ branchId }) },
      t("adminExtra.message011"),
    );
  };

  const addBranchOptionForPlan = (groupId, values) =>
    applyBranchMutation(
      `/api/trips/${encodeURIComponent(selectedSlug)}/branches/${groupId}`,
      { method: "POST", body: JSON.stringify(values) },
      t("adminExtra.message012"),
    );

  const updateBranchOptionForPlan = (groupId, branchId, values) =>
    applyBranchMutation(
      `/api/trips/${encodeURIComponent(selectedSlug)}/branches/${groupId}/${branchId}`,
      { method: "PATCH", body: JSON.stringify(values) },
      t("adminExtra.message013"),
    );

  const deleteBranchOptionForPlan = (groupId, branchId) =>
    applyBranchMutation(
      `/api/trips/${encodeURIComponent(selectedSlug)}/branches/${groupId}/${branchId}`,
      { method: "DELETE" },
      t("adminExtra.message014"),
    );

  const unwrapBranchGroupForPlan = (groupId, keepBranchId) =>
    applyBranchMutation(
      `/api/trips/${encodeURIComponent(selectedSlug)}/branches/${groupId}`,
      { method: "DELETE", body: JSON.stringify({ keepBranchId }) },
      t("adminExtra.message015"),
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
    setNotice(source.kind === "route"
      ? t(sourceNumber == null ? "adminRoutes.added" : "adminRoutes.saved", { number: source.number, title: source.title })
      : t(sourceNumber == null ? "adminExtra.message016" : "adminExtra.message017", { value0: source.number, value1: source.title }));
    return source;
  };

  const removeSourceForPlan = (source) => {
    const usageCount = sourceUsageCount(plan, source.number);
    const usageMessage = usageCount
      ? t("adminExtra.message018", { value0: usageCount })
      : "";
    if (
      !window.confirm(
        t("adminExtra.message019", {
          value0: source.number,
          value1: source.title,
          value2: usageMessage,
        }),
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
      setNotice(
        t("adminExtra.message020", {
          value0: source.number,
          value1: source.title,
        }),
      );
    });
  };

  const savePlace = async (values, placeId = null) => {
    const base = `/api/trips/${encodeURIComponent(selectedSlug)}/places`;
    const place = await api(placeId ? `${base}/${placeId}` : base, {
      method: placeId ? "PATCH" : "POST",
      body: JSON.stringify(values),
    });
    setPlan((current) => current ? {
      ...current,
      places: placeId
        ? current.places.map((item) => item.id === place.id ? place : item)
        : [...current.places, place],
    } : current);
    setPlaceEditor(null);
    setNotice(placeId ? t("adminPlaces.updated") : t("adminPlaces.created"));
    return place;
  };

  const removePlaceForPlan = (place) => {
    const usageCount = placeUsageCount(plan, place.id);
    const usage = usageCount ? t("adminPlaces.unlinkWarning", { count: usageCount }) : "";
    if (!window.confirm(t("adminPlaces.deleteConfirm", { name: place.name, usage }))) return;
    run(async () => {
      await api(`/api/trips/${encodeURIComponent(selectedSlug)}/places/${place.id}`, { method: "DELETE" });
      setPlaceEditor(null);
      await refreshPlan(selectedSlug);
      setNotice(t("adminPlaces.deleted"));
    });
  };

  const removeSchedule = (activityId) => {
    if (!window.confirm(t("adminExtra.message021"))) return;
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
          ? t("adminExtra.message022")
          : t("adminExtra.message023"),
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
      setNotice(t("adminExtra.message024"));
    } catch (requestError) {
      setSuggestionDeleteError(
        t("adminExtra.message025", {
          value0: adminErrorMessage(requestError, t, locale),
        }),
      );
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
            {t("adminExtra.message026")}
          </Link>
          <h1>{scope === "admin" ? t("admin.tripManagement") : t("visibility.myTripManagement")}</h1>
          <small className={adminShellStyles["admin-user"]}>
            {user.authMode === "local-dev"
              ? t("adminExtra.localAdmin")
              : user.email}
          </small>
        </div>
        <LanguageSwitcher />
        {user.localPersonaSwitcher && <Link href="/dev/personas" className={adminShellStyles["admin-back"]}>Test personas</Link>}
        {user.authMode !== "local-dev" && (
          <Button variant="ghost" onClick={logout}>
            {t("common.logout")}
          </Button>
        )}
      </header>
      {error && (
        <div className={adminShellStyles["admin-alert"]} role="alert">
          {error}
          <button
            onClick={() => setError("")}
            aria-label={t("adminExtra.message027")}
          >
            <ActionIcon name="close" />
          </button>
        </div>
      )}
      {notice && (
        <div className={adminShellStyles["admin-notice"]} role="status">
          {notice}
          <button
            onClick={() => setNotice("")}
            aria-label={t("adminExtra.message027")}
          >
            <ActionIcon name="close" />
          </button>
        </div>
      )}

      {scope === "admin" && <AdminNav
          tripSlug={selectedSlug}
          active="trips"
          pendingInvitationCount={pendingInvitationCount}
          pendingTripRequestCount={pendingTripRequestCount}
        />}

      <div className={adminShellStyles["admin-grid"]}>
        <aside className={adminShellStyles["admin-sidebar"]}>
          <div className={adminShellStyles["admin-section-head"]}>
            <h2>{t("adminExtra.message028")}</h2>
            <Button
              variant="primary"
              className="small"
              onClick={(event) =>
                guardScheduleDraft(
                  () => {
                    setScheduleEditor(null);
                    setTripEditor({ values: { ...emptyTrip, memberEmails: [] }, originalSlug: null });
                  },
                  t("adminExtra.message003", {
                    value0:
                      scheduleEditor?.values.title ||
                      t("adminExtra.message004"),
                  }),
                )
              }
            >
              {t("adminExtra.message029")}
            </Button>
          </div>
          <div className={adminShellStyles["trip-list"]}>
            {scope === "admin" && <label className={adminShellStyles["ownership-filter"]}>
              <span>{t("visibility.ownershipFilter")}</span>
              <select value={ownershipFilter} onChange={(event) => {
                const next = event.target.value; setOwnershipFilter(next);
                loadTrips(null, next).then(refreshPlan).catch((requestError) => setError(adminErrorMessage(requestError, t, locale)));
              }}>
                <option value="all">{t("visibility.allTrips")}</option><option value="mine">{t("visibility.myLedTrips")}</option><option value="others">{t("visibility.otherTrips")}</option>
              </select>
            </label>}
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
                  {formatTripDateRange(trip, {}, intlLocale)} ·{" "}
                  {trip.scheduleCount} {t("adminExtra.message030")}
                </span>
                <span>{trip.leader?.displayName || t("visibility.leader")} · {trip.memberCount} {t("visibility.people")}</span>
              </button>
            ))}
            {!trips.length && (
              <p className={scheduleEditorStyles["admin-empty"]}>
                {t("adminExtra.message031")}
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
                    {formatTripDateRange(plan.trip, {}, intlLocale)} ·{" "}
                    {plan.trip.location} · {plan.trip.timezone} · {plan.trip.currency}
                  </p>
                </div>
                <div className={scheduleEditorStyles["admin-actions"]}>
                  <ShareTripButton key={plan.trip.slug} slug={plan.trip.slug} />
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
                        t("adminExtra.message003", {
                          value0:
                            scheduleEditor?.values.title ||
                            t("adminExtra.message004"),
                        }),
                      )
                    }
                  >
                    {t("adminExtra.message032")}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => removeTrip(plan.trip.slug)}
                  >
                    {t("adminExtra.message033")}
                  </Button>
                </div>
              </div>

              {scope === "admin" && (
                <div className={adminShellStyles["workspace-tabs"]} role="tablist" aria-label={t("visibility.tripWorkspace")}>
                  <button type="button" role="tab" aria-selected={workspaceTab === "plan"} onClick={() => setWorkspaceTab("plan")}>{t("visibility.planTab")}</button>
                  <button type="button" role="tab" aria-selected={workspaceTab === "activity"} onClick={() => setWorkspaceTab("activity")}>{t("visibility.activityTab")}</button>
                </div>
              )}

              {workspaceTab === "activity" && scope === "admin" ? (
                <AuditTimeline events={auditEvents} />
              ) : <>
              <MemberManager members={members} email={memberEmail} busy={memberBusy} error={memberError}
                onEmailChange={setMemberEmail} onAdd={addMember} onRemove={removeMember} onTransfer={transferLeader}
                onExpensePermission={setMemberExpensePermission}
                onInvite={() => setInvitationOpen(true)} />

              <ExpenseSummary ledger={expenseLedger} placement="admin" />

              {["route", "reference"].map((kind) => {
                const sources = plan.sources.filter((source) => (source.kind ?? "reference") === kind);
                const isRoute = kind === "route";
                const editing = sourceEditor?.kind === kind;
                const headingId = isRoute ? "admin-routes-title" : "admin-references-title";
                return (
                  <section className={scheduleEditorStyles["admin-sources"]} aria-labelledby={headingId} key={kind}>
                    <div className={`${adminShellStyles["admin-section-head"]} ${scheduleEditorStyles["source-heading"]}`}>
                      <h2 id={headingId}>{sources.length} {t(isRoute ? "adminSources.route" : "adminSources.reference")}</h2>
                      <Button
                        variant="primary"
                        type="button"
                        onClick={() => setSourceEditor((current) => current?.kind === kind && !current.source ? null : { kind, source: null })}
                        aria-expanded={editing}
                      >
                        {editing && !sourceEditor.source
                          ? t("adminExtra.message035")
                          : t(isRoute ? "adminRoutes.add" : "adminSources.addReference")}
                      </Button>
                    </div>
                    {editing && (
                      <SourceForm
                        key={sourceEditor.source?.number ?? `new-${kind}`}
                        kind={kind}
                        source={sourceEditor.source}
                        onSave={(values) => saveSource(values, sourceEditor.source?.number)}
                        onCancel={() => setSourceEditor(null)}
                      />
                    )}
                    {sources.length ? (
                      <div className={scheduleEditorStyles["admin-source-list"]}>
                        {sources.map((source) => (
                          <article
                            className={`${scheduleEditorStyles["admin-source-item"]}${sourceEditor?.source?.number === source.number ? " is-editing" : ""}`}
                            key={source.number}
                          >
                            <span className={scheduleEditorStyles["admin-source-number"]}>
                              {String(source.number).padStart(2, "0")}
                            </span>
                            <a className={scheduleEditorStyles["admin-source-link"]} href={source.url} target="_blank" rel="noreferrer">
                              <span className={scheduleEditorStyles["admin-source-copy"]}>
                                <strong>{source.title}</strong>
                                <small>{isRoute && source.routeStart && source.routeEnd && source.title !== `${source.routeStart} → ${source.routeEnd}`
                                  ? `${source.routeStart} → ${source.routeEnd}`
                                  : source.host}</small>
                              </span>
                              <ActionIcon name="external" />
                            </a>
                            <span className={scheduleEditorStyles["admin-source-actions"]}>
                              <Button variant="ghost" type="button" onClick={() => setSourceEditor({ kind, source })} disabled={busy}>
                                {t("adminExtra.message037")}
                              </Button>
                              <Button variant="danger" type="button" onClick={() => removeSourceForPlan(source)} disabled={busy}>
                                {t("adminExtra.message033")}
                              </Button>
                            </span>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className={scheduleEditorStyles["admin-empty"]}>
                        {t(isRoute ? "adminRoutes.empty" : "adminSources.emptyReferences")}
                      </p>
                    )}
                  </section>
                );
              })}

              <section
                className={scheduleEditorStyles["admin-places"]}
                aria-labelledby="admin-places-title"
                aria-label={t("adminPlaces.title")}
              >
                <div className={`${adminShellStyles["admin-section-head"]} ${scheduleEditorStyles["place-heading"]}`}>
                  <div>
                    <h2 id="admin-places-title">{t("adminPlaces.title")} · {plan.places.length}</h2>
                    <p>{t("adminPlaces.description")}</p>
                  </div>
                  <Button
                    variant="primary"
                    type="button"
                    aria-expanded={placeEditor?.place == null && Boolean(placeEditor)}
                    onClick={() => setPlaceEditor((current) => current && current.place == null ? null : { place: null })}
                  >
                    {placeEditor?.place == null && placeEditor ? t("adminPlaces.cancel") : t("adminPlaces.add")}
                  </Button>
                </div>
                {placeEditor?.place == null && placeEditor && <PlaceForm onSave={(values) => savePlace(values)} onCancel={() => setPlaceEditor(null)} />}
                <div className={scheduleEditorStyles["admin-place-list"]}>
                  {plan.places.map((place) => <div key={place.id}>
                    {placeEditor?.place?.id === place.id
                      ? <PlaceForm place={place} onSave={(values) => savePlace(values, place.id)} onCancel={() => setPlaceEditor(null)} />
                      : <article className={scheduleEditorStyles["admin-place-item"]}>
                        <div className={scheduleEditorStyles["admin-place-copy"]}>
                          <h3>{place.name}</h3>
                          {place.address && <p>{place.address}</p>}
                          {place.notes && <p>{place.notes}</p>}
                          {place.latitude != null && <small>{t("adminPlaces.coordinates", { latitude: place.latitude, longitude: place.longitude })}</small>}
                          <div className={scheduleEditorStyles["admin-place-links"]}>
                            {place.website && <a href={place.website} target="_blank" rel="noreferrer">{t("adminPlaces.website")}</a>}
                            {(place.googleMapsUrl || place.googlePlaceId) && <a href={place.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}&query_place_id=${encodeURIComponent(place.googlePlaceId)}`} target="_blank" rel="noreferrer">Google Maps</a>}
                          </div>
                        </div>
                        <div className={scheduleEditorStyles["admin-row-actions"]}>
                          <Button variant="ghost" type="button" disabled={busy} onClick={() => setPlaceEditor({ place })}>{t("adminPlaces.edit")}</Button>
                          <Button variant="danger" type="button" disabled={busy} onClick={() => removePlaceForPlan(place)}>{t("adminPlaces.delete")}</Button>
                        </div>
                      </article>}
                  </div>)}
                  {!plan.places.length && <p className={scheduleEditorStyles["admin-empty"]}>{t("adminPlaces.empty")}</p>}
                </div>
              </section>

              <div
                className={`${adminShellStyles["admin-section-head"]} ${scheduleEditorStyles["schedule-heading"]}`}
              >
                <div>
                  <h2>
                    {plan.itinerary.length} {t("adminExtra.message039")}
                  </h2>
                  <p>
                    {plan.branchGroups?.length || 0}{" "}
                    {t("adminExtra.message040")}
                  </p>
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
                      {t("adminExtra.message041")}
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
                    {t("adminExtra.message042")}
                  </Button>
                </div>
              </div>
              <div
                className={scheduleEditorStyles["admin-day-rail"]}
                aria-label={t("adminExtra.message043")}
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
                        <span>
                          {t("adminExtra.dayNumber", { count: index + 1 })}
                        </span>
                        <strong>
                          {formatDateLabel(
                            date,
                            plan.trip.timezone,
                            {
                              weekday: "short",
                              day: "2-digit",
                              month: "2-digit",
                            },
                            intlLocale,
                          )}
                        </strong>
                        <small>
                          {count
                            ? t("adminExtra.message045", { value0: count })
                            : t("adminExtra.message042")}
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
                    expenseLedger={expenseLedger}
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
                              {t("adminExtra.dayNumber", {
                                count:
                                  calendarDayDifference(
                                    plan.trip.startDate,
                                    item.startDate,
                                  ) + 1,
                              })}
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
                                intlLocale,
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
                            {t("adminExtra.message046")}
                          </Button>
                        </div>
                      )}
                      <ScheduleRow
                        item={item}
                        expenseLedger={expenseLedger}
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
                            {t("adminExtra.message047")}
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
                          expenseLedger={expenseLedger}
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
                  <h2>
                    {suggestions.length} {t("adminExtra.message048")}
                  </h2>
                  <p>{t("adminExtra.message049")}</p>
                </div>
                <div
                  className={scheduleEditorStyles["admin-suggestion-filters"]}
                  role="group"
                  aria-label={t("adminExtra.message050")}
                >
                  <button
                    type="button"
                    aria-pressed={suggestionFilter === "visible"}
                    onClick={() => setSuggestionFilter("visible")}
                  >
                    {t("adminExtra.message051")}{" "}
                    <span>
                      {suggestions.filter((item) => !item.hidden).length}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={suggestionFilter === "hidden"}
                    onClick={() => setSuggestionFilter("hidden")}
                  >
                    {t("adminExtra.message052")}{" "}
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
                              ? t("adminExtra.message053")
                              : t("adminExtra.message054")}
                          </span>
                          <strong>{suggestion.author.name}</strong>
                          <small>{suggestion.author.email}</small>
                          {suggestion.hidden && (
                            <em>{t("adminExtra.message052")}</em>
                          )}
                        </div>
                        <div
                          className={
                            scheduleEditorStyles["admin-suggestion-copy"]
                          }
                        >
                          <small>
                            {activity
                              ? `${activity.start} · ${activity.title}`
                              : t("adminExtra.message055")}
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
                            aria-label={t("adminExtra.message056")}
                          >
                            <option value="open">
                              {t("adminExtra.message057")}
                            </option>
                            <option value="accepted">
                              {t("adminExtra.message058")}
                            </option>
                            <option value="resolved">
                              {t("adminExtra.message059")}
                            </option>
                            <option value="rejected">
                              {t("adminExtra.message060")}
                            </option>
                          </select>
                          <Button
                            variant="ghost"
                            type="button"
                            onClick={() =>
                              updateSuggestionVisibility(suggestion)
                            }
                            disabled={busy}
                          >
                            {suggestion.hidden
                              ? t("adminExtra.message061")
                              : t("adminExtra.message062")}
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
                    {t("adminExtra.message063")}
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
                        ? t("adminExtra.message064")
                        : t("adminExtra.message065")}
                    </p>
                  )}
              </div>
              </>}
            </>
          )}
          {!tripEditor && !loadingPlan && !plan && (
            <div
              className={`${scheduleEditorStyles["admin-empty"]} ${scheduleEditorStyles["large"]}`}
            >
              {t("adminExtra.message066")}
            </div>
          )}
        </section>
      </div>
      {discardDialog}
      {suggestionToDelete && (
        <ConfirmDialog
          title={t("adminExtra.message067")}
          description={t("adminExtra.message068", {
            value0: suggestionToDelete.author.name,
          })}
          preview={suggestionToDelete.body}
          confirmLabel={t("adminExtra.message069")}
          pendingLabel={t("adminExtra.message070")}
          pending={busy}
          error={suggestionDeleteError}
          onCancel={() => {
            setSuggestionToDelete(null);
            setSuggestionDeleteError("");
          }}
          onConfirm={confirmRemoveSuggestion}
        />
      )}
      {invitationOpen && plan && <InvitationDialog open viewer={user} trip={plan.trip} itinerary={plan.itinerary}
        onClose={() => setInvitationOpen(false)} />}
    </main>
  );
}

function MemberManager({ members, email, busy, error, onEmailChange, onAdd, onRemove, onTransfer, onExpensePermission, onInvite }) {
  const { t, intlLocale } = useLocale();
  return (
    <section className={adminShellStyles["member-section"]} aria-labelledby="trip-members-title">
      <div className={adminShellStyles["admin-section-head"]}>
        <div><h2 id="trip-members-title">{t("visibility.members")}</h2><p>{t("visibility.memberHelp")}</p></div>
        <button className={adminShellStyles["member-email-action"]} type="button" onClick={onInvite}>
          <ActionIcon name="invite" />
          <span>{t("visibility.emailMembers")}</span>
        </button>
      </div>
      <form className={adminShellStyles["member-add"]} onSubmit={onAdd}>
        <label><span>{t("visibility.registeredEmail")}</span><input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} required placeholder="friend@example.com" /></label>
        <Button variant="primary" disabled={busy}>{busy ? t("common.loading") : t("visibility.addMember")}</Button>
      </form>
      {error && <p className={adminShellStyles["member-error"]} role="alert">{error}</p>}
      <ul className={adminShellStyles["member-list"]}>
        {members.map((member) => (
          <li className={adminShellStyles["member-row"]} key={member.email || `${member.displayName}-${member.role}`}>
            <time className={adminShellStyles["member-time"]} dateTime={member.joinedAt}>{new Intl.DateTimeFormat(intlLocale, { month: "short", day: "2-digit" }).format(new Date(member.joinedAt))}</time>
            <span className={adminShellStyles["member-stop"]} aria-hidden="true" />
            <span className={adminShellStyles["member-identity"]}><strong>{member.displayName}</strong><small>{member.email}</small></span>
            <strong className={adminShellStyles["member-role"]}>{member.role === "leader" ? t("visibility.leader") : t("visibility.member")}</strong>
            {member.role !== "leader" && <label className={adminShellStyles["member-expense-permission"]}>
              <input type="checkbox" checked={Boolean(member.canManageExpenses)} disabled={busy}
                onChange={(event) => onExpensePermission(member.email, event.target.checked)} />
              <span><strong>{t("expenses.permission")}</strong><small>{t("expenses.permissionHelp")}</small></span>
            </label>}
            {member.role !== "leader" && <span className={adminShellStyles["member-actions"]}>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => onTransfer(member.email)}>{t("visibility.makeLeader")}</Button>
              <Button type="button" variant="danger" disabled={busy} onClick={() => onRemove(member.email)}>{t("common.delete")}</Button>
            </span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AuditTimeline({ events }) {
  const { t, intlLocale } = useLocale();
  return (
    <section className={adminShellStyles["audit-section"]} aria-labelledby="audit-title">
      <div className={adminShellStyles["admin-section-head"]}><h2 id="audit-title">{t("visibility.auditTitle")}</h2></div>
      <div className={adminShellStyles["audit-list"]}>
        {events.map((event) => <article key={event.id}>
          <time>{new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.createdAt))}</time>
          <div><strong>{event.actor.name}</strong><p>{event.action}</p><small>{event.source} · {event.entity.type}{event.entity.id ? ` · ${event.entity.id}` : ""}</small></div>
        </article>)}
        {!events.length && <p className={scheduleEditorStyles["admin-empty"]}>{t("visibility.noAudit")}</p>}
      </div>
    </section>
  );
}

function AdminSuggestionMenu({ suggestion, busy, onDelete }) {
  const { t } = useLocale();
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
        {t("adminExtra.message029")}
      </Button>
      {open && (
        <div>
          <Button
            variant="danger"
            type="button"
            onClick={() => onDelete(suggestion)}
          >
            {t("adminExtra.message069")}
          </Button>
        </div>
      )}
    </div>
  );
}

function ScheduleRow({
  item,
  expenseLedger,
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
  const { t, locale, intlLocale } = useLocale();
  const editorId = `schedule-editor-${item.id}`;
  const isEditing = scheduleEditor?.key === String(item.id);
  return (
    <article
      className={`${scheduleEditorStyles["admin-schedule-item"]}${isEditing ? " is-editing" : ""}`}
    >
      <div className={scheduleEditorStyles["admin-schedule-time"]}>
        <small>{formatDateLabel(item.startDate, "UTC", {}, intlLocale)}</small>
        <strong>{item.start}</strong>
        <span>
          {item.displayEnd || item.end}
          {item.endDate !== item.startDate ? t("adminExtra.message071") : ""}
        </span>
      </div>
      <div className={scheduleEditorStyles["admin-schedule-copy"]}>
        <span>
          <TypeIcon type={item.type} />{" "}
          {locale === "vi"
            ? item.type
            : translateActivityType(locale, item.type)}
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
          {isEditing ? t("adminExtra.message072") : t("adminExtra.message037")}
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => onRemove(item.id)}
        >
          {t("adminExtra.message033")}
        </Button>
      </div>
      <ActivityExpenses activity={item} ledger={expenseLedger} placement="schedule" />
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
  const { t } = useLocale();
  const startsTrip = anchor == null;
  const selectableActivities = startsTrip ? following.slice(0, -1) : following;
  const [segmentCount, setSegmentCount] = useState(1);
  const [values, setValues] = useState({
    title: t("adminExtra.message073"),
    defaultLabel: t("adminExtra.message074"),
    defaultCondition: t("adminExtra.message075"),
    alternateLabel: t("adminExtra.message076"),
    alternateCondition: t("adminExtra.message077"),
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
              ? t("adminExtra.message078")
              : t("adminExtra.message079", { value0: anchor.title })}
          </h2>
          <p>
            {startsTrip
              ? t("adminExtra.message080")
              : t("adminExtra.message081")}
          </p>
        </div>
        <Button variant="ghost" type="button" onClick={onCancel}>
          {t("adminExtra.message082")}
        </Button>
      </div>
      <div className={scheduleEditorStyles["form-grid"]}>
        <label className="wide">
          {t("adminExtra.message083")} <input {...field("title")} required />
        </label>
        <label className="wide">
          {t("adminExtra.message084")}{" "}
          <select
            value={segmentCount}
            onChange={(event) => setSegmentCount(Number(event.target.value))}
          >
            {selectableActivities.map((item, index) => (
              <option value={index + 1} key={item.id}>
                {index + 1 < following.length
                  ? t("adminExtra.message085", {
                      value0: following[index + 1].start,
                      value1: following[index + 1].title,
                    })
                  : t("adminExtra.message086")}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("adminExtra.message087")}{" "}
          <input {...field("defaultLabel")} required />
        </label>
        <label>
          {t("adminExtra.message088")}{" "}
          <input {...field("defaultCondition")} required />
        </label>
        <label>
          {t("adminExtra.message089")}{" "}
          <input {...field("alternateLabel")} required />
        </label>
        <label>
          {t("adminExtra.message088")}{" "}
          <input {...field("alternateCondition")} required />
        </label>
      </div>
      <div className={scheduleEditorStyles["schedule-editor-actions"]}>
        <Button variant="ghost" type="button" onClick={onCancel}>
          {t("adminExtra.message082")}
        </Button>
        <Button variant="primary" disabled={busy}>
          {busy
            ? t("adminExtra.message090")
            : t("adminExtra.message091", {
                value0: segmentCount,
                value1: startsTrip ? t("adminExtra.message092") : "",
              })}
        </Button>
      </div>
    </form>
  );
}

function BranchGroupAdmin({
  group,
  startsTrip = false,
  expenseLedger,
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
  const { t } = useLocale();
  const [adding, setAdding] = useState(false);
  const [newBranch, setNewBranch] = useState({ label: "", condition: "" });
  const [keepBranchId, setKeepBranchId] = useState(group.selectedBranchId);
  const selected =
    group.branches.find((branch) => branch.id === group.selectedBranchId) ||
    group.branches[0];
  const unwrap = () => {
    if (
      !window.confirm(
        t("adminExtra.message093", {
          value0: group.branches.find((branch) => branch.id === keepBranchId)
            ?.label,
        }),
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
            {startsTrip
              ? t("adminExtra.message094")
              : t("adminExtra.message095")}{" "}
            · {group.branches.length} {t("adminExtra.message096")}
          </span>
          <h3 id={`branch-group-${group.id}`}>{group.title}</h3>
          <p>
            {t("adminExtra.message097")} <strong>{selected.label}</strong> ·{" "}
            {selected.condition}
          </p>
        </div>
        <Button
          variant="ghost"
          type="button"
          onClick={() => setAdding((current) => !current)}
          disabled={busy}
        >
          {adding ? t("adminExtra.message098") : t("adminExtra.message099")}
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
            {t("adminExtra.message100")}{" "}
            <input
              value={newBranch.label}
              onChange={(event) =>
                setNewBranch({ ...newBranch, label: event.target.value })
              }
              required
            />
          </label>
          <label>
            {t("adminExtra.message088")}{" "}
            <input
              value={newBranch.condition}
              onChange={(event) =>
                setNewBranch({ ...newBranch, condition: event.target.value })
              }
              required
            />
          </label>
          <Button variant="primary" disabled={busy}>
            {t("adminExtra.message099")}
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
            expenseLedger={expenseLedger}
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
          {t("adminExtra.message101")}{" "}
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
          {t("adminExtra.message102")}
        </Button>
      </div>
    </section>
  );
}

function BranchOptionAdmin({
  group,
  branch,
  selected,
  expenseLedger,
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
  const { t } = useLocale();
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
            {selected ? t("adminExtra.message103") : t("adminExtra.message104")}
            {branch.isDefault ? t("adminExtra.message105") : ""}
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
              {t("adminExtra.message106")}
            </Button>
          )}
          <Button
            variant="ghost"
            type="button"
            onClick={() => setEditing((current) => !current)}
            disabled={busy}
          >
            {t("adminExtra.message107")}
          </Button>
          {!selected && !branch.isDefault && group.branches.length > 2 && (
            <Button
              variant="danger"
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    t("adminExtra.message108", { value0: branch.label }),
                  )
                )
                  onDelete(group.id, branch.id);
              }}
              disabled={busy}
            >
              {t("adminExtra.message033")}
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
            {t("adminExtra.message109")}{" "}
            <input
              value={values.label}
              onChange={(event) =>
                setValues({ ...values, label: event.target.value })
              }
              required
            />
          </label>
          <label>
            {t("adminExtra.message088")}{" "}
            <input
              value={values.condition}
              onChange={(event) =>
                setValues({ ...values, condition: event.target.value })
              }
              required
            />
          </label>
          <Button variant="primary" disabled={busy}>
            {t("adminExtra.message110")}
          </Button>
        </form>
      )}
      <div className={scheduleEditorStyles["admin-branch-activities"]}>
        {branch.itinerary.map((item) => (
          <ScheduleRow
            key={item.id}
            item={item}
            expenseLedger={expenseLedger}
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
            {t("adminExtra.message111")}
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
          {t("adminExtra.addActivityToBranch", { label: branch.label })}
        </Button>
      )}
    </article>
  );
}

function PlanSkeleton() {
  const { t } = useLocale();
  return (
    <div
      className={scheduleEditorStyles["admin-plan-skeleton"]}
      aria-live="polite"
      aria-label={t("adminExtra.message113")}
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
