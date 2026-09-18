"use client";
import SavedPlaces from "./tracker/SavedPlaces";
import trackerStyles from "../src/styles/tracker.module.css";
import navigationStyles from "../src/styles/navigation.module.css";
import contributionsStyles from "../src/styles/contributions.module.css";
import scheduleEditorStyles from "../src/styles/schedule-editor.module.css";

import { AssistantLauncher } from "./v1/AssistantProvider";
import { ScheduleForm } from "./admin/EditorForms";
import { useScheduleDraft } from "./admin/useScheduleDraft";
import Button from "./ui/Button";
import ConfirmDialog from "./ConfirmDialog";
import Footer from "./ui/Footer";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ADMIN_ROUTES } from "../lib/admin-routes.mjs";
import { parseContactDirectory } from "../lib/contact-directory.mjs";
import {
  formatScheduleHeading,
  formatTripTitle,
} from "../lib/trip-date-label.mjs";
import { getTripPageTitle } from "../lib/trip-page-title.mjs";
import { getTripTrackerState } from "../lib/trip-tracker-state.mjs";
import {
  addCalendarDays,
  activityInstants,
  enumerateTripDays,
  formatDateLabel,
  formatTripDateRange,
} from "../lib/trip-dates.mjs";
import { ActionIcon, TypeIcon } from "./Icons";
import { SuggestionList, useContributions } from "./tracker/Contributions";
import { ActivityExpenses, ExpenseSummary, useExpenseLedger } from "./tracker/Expenses";
import InvitationDialog from "./InvitationDialog";
import NotificationCenter from "./NotificationCenter";
import ViewerMenu from "./ViewerMenu";
import TripMembersPanel from "./TripMembersPanel";
import LanguageSwitcher from "./LanguageSwitcher";
import { useLocale } from "./LocaleProvider";
import { translateActivityType } from "../lib/i18n.mjs";
import { adminErrorMessage } from "../lib/i18n-admin.mjs";
import { requestJson as api } from "../lib/request-json.mjs";
import { normalizeScheduleRefs } from "../lib/schedule-editor-state.mjs";

const NOTIFICATION_NAVIGATION_EVENT = "travel-plan:notification-navigation";
const PREPARATION_SECTION = "preparation";
const POST_TRIP_SECTION = "post-trip";

const scheduleSectionForDate = (date, startDate, endDate) => {
  if (date < startDate) return PREPARATION_SECTION;
  if (date > endDate) return POST_TRIP_SECTION;
  return date;
};

const EMPTY_SCHEDULE = {
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

const formatDuration = (milliseconds, t) => {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0)
    return {
      value: `${hours}h ${String(minutes).padStart(2, "0")}`,
      unit: t("tracker.hoursMinutes"),
    };
  return {
    value: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
    unit: t("tracker.minutesSeconds"),
  };
};

export default function TripTracker({
  initialData,
  initialNow,
  initialInvitationOpen = false,
  initialGmailReturn = false,
  viewer,
  trips,
  access,
}) {
  const router = useRouter();
  const { t, intlLocale, locale } = useLocale();
  const [data, setData] = useState(initialData);
  const expenseLedger = useExpenseLedger(initialData.trip.slug);
  const [now, setNow] = useState(() => new Date(initialNow));
  const [announcement, setAnnouncement] = useState("");
  const {
    suggestions,
    openSuggestion,
    listProps: suggestionListProps,
    dialogs: contributionDialogs,
  } = useContributions({
    tripSlug: initialData.trip.slug,
    viewer,
    announce: setAnnouncement,
  });
  const [branchAction, setBranchAction] = useState({ id: null, error: "" });
  const [invitationOpen, setInvitationOpen] = useState(initialInvitationOpen);
  const [gmailReturn, setGmailReturn] = useState(initialGmailReturn);
  const [membersOpen, setMembersOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState(initialData.trip.startDate);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleNotice, setScheduleNotice] = useState("");
  const [activityToDelete, setActivityToDelete] = useState(null);
  const [scheduleDeleteError, setScheduleDeleteError] = useState("");
  const {
    editor: scheduleEditor,
    setEditor: setScheduleEditor,
    error: scheduleError,
    setError: setScheduleError,
    activate: activateScheduleEditor,
    close: closeScheduleEditor,
    guard: guardScheduleDraft,
    restoreFocus: restoreScheduleFocus,
    discardDialog,
  } = useScheduleDraft(scheduleBusy);
  const routeListRef = useRef(null);
  const activeStopRef = useRef(null);
  const stationStageRef = useRef(null);
  const daySelectorRef = useRef(null);
  const previousLiveDayRef = useRef(initialData.trip.startDate);

  const itinerary = useMemo(
    () =>
      data.itinerary.map((item) => ({
        ...item,
        ...activityInstants(item, data.trip.timezone),
      })),
    [data],
  );

  const refreshItinerary = useCallback(
    () =>
      fetch(`/api/itinerary?slug=${encodeURIComponent(initialData.trip.slug)}`)
        .then((response) =>
          response.ok
            ? response.json()
            : Promise.reject(new Error("API request failed")),
        )
        .then(setData)
        .catch(() => {}),
    [initialData.trip.slug],
  );

  const loadLatestItinerary = useCallback(async () => {
    const nextData = await api(
      `/api/itinerary?slug=${encodeURIComponent(initialData.trip.slug)}`,
    );
    setData(nextData);
    return nextData;
  }, [initialData.trip.slug]);

  const saveSchedule = async (values, activityId) => {
    setScheduleBusy(true);
    setScheduleError("");
    setScheduleNotice("");
    try {
      const payload = {
        ...values,
        displayEnd: values.displayEnd || null,
        refs: normalizeScheduleRefs(values.refs),
      };
      delete payload.id;
      const base = `/api/trips/${encodeURIComponent(data.trip.slug)}/schedule`;
      await api(activityId ? `${base}/${activityId}` : base, {
        method: activityId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      await loadLatestItinerary();
      setScheduleEditor(null);
      const message = activityId
        ? t("adminExtra.message006")
        : t("adminExtra.message007");
      setScheduleNotice(message);
      setAnnouncement(message);
      restoreScheduleFocus();
    } catch (requestError) {
      setScheduleError(adminErrorMessage(requestError, t, locale));
    } finally {
      setScheduleBusy(false);
    }
  };

  const createScheduleSource = async (values) => {
    const source = await api(
      `/api/trips/${encodeURIComponent(data.trip.slug)}/sources`,
      { method: "POST", body: JSON.stringify(values) },
    );
    setData((current) => ({
      ...current,
      sources: [...current.sources, source],
    }));
    return source;
  };

  const openNewScheduleEditor = (trigger) => {
    const selectedDates = itinerary
      .filter(
        (item) =>
          scheduleSectionForDate(
            item.startDate,
            data.trip.startDate,
            data.trip.endDate,
          ) === selectedDay,
      )
      .map((item) => item.startDate);
    const date =
      selectedDay === PREPARATION_SECTION
        ? selectedDates.at(-1) || addCalendarDays(data.trip.startDate, -1)
        : selectedDay === POST_TRIP_SECTION
          ? selectedDates[0] || addCalendarDays(data.trip.endDate, 1)
          : selectedDay;
    activateScheduleEditor(
      {
        ...EMPTY_SCHEDULE,
        startDate: date,
        endDate: date,
      },
      trigger,
    );
  };

  const selectTripDay = (date, trigger) =>
    guardScheduleDraft(
      () => {
        setScheduleEditor(null);
        setScheduleError("");
        setSelectedDay(date);
        trigger?.focus?.();
      },
      t("adminExtra.message003", {
        value0:
          scheduleEditor?.values.title || t("adminExtra.message004"),
      }),
    );

  const requestScheduleDelete = (item) =>
    guardScheduleDraft(
      () => {
        setScheduleDeleteError("");
        setActivityToDelete(item);
      },
      t("adminExtra.message003", {
        value0:
          scheduleEditor?.values.title || t("adminExtra.message004"),
      }),
    );

  const deleteScheduleItem = async () => {
    if (!activityToDelete) return;
    setScheduleBusy(true);
    setScheduleDeleteError("");
    try {
      await api(
        `/api/trips/${encodeURIComponent(data.trip.slug)}/schedule/${activityToDelete.id}`,
        { method: "DELETE" },
      );
      await loadLatestItinerary();
      setScheduleEditor(null);
      setActivityToDelete(null);
      const message = t("adminExtra.message238");
      setScheduleNotice(message);
      setAnnouncement(message);
    } catch (requestError) {
      setScheduleDeleteError(adminErrorMessage(requestError, t, locale));
    } finally {
      setScheduleBusy(false);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshItinerary();
    }, 30_000);
    refreshItinerary();
    window.addEventListener("assistant-resources-changed", refreshItinerary);
    return () => {
      window.removeEventListener("assistant-resources-changed", refreshItinerary);
      window.clearInterval(timer);
      window.clearInterval(poll);
    };
  }, [initialData.trip.slug, refreshItinerary]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("invite") === "1") {
      window.sessionStorage.removeItem("travel-plan:invite:return");
    }
    if (url.searchParams.has("invite") || url.searchParams.has("gmail")) {
      url.searchParams.delete("invite");
      url.searchParams.delete("gmail");
      window.history.replaceState({}, "", url);
    }
  }, []);

  useEffect(() => {
    if (!suggestions.length) return undefined;
    let frame;
    let timer;
    const revealContribution = (event) => {
      const url = new URL(
        event?.detail?.targetUrl || window.location.href,
        window.location.origin,
      );
      const targetTrip = url.searchParams.get("trip");
      if (targetTrip && targetTrip !== data.trip.slug) return;
      const match = url.hash.match(/^#contribution-(\d+)$/);
      if (!match) return;
      const contribution = suggestions.find(
        (item) => String(item.id) === match[1],
      );
      const activity =
        contribution?.activityId &&
        data.itinerary.find(
          (item) => String(item.id) === String(contribution.activityId),
        );
      if (activity?.startDate) {
        setSelectedDay(
          scheduleSectionForDate(
            activity.startDate,
            data.trip.startDate,
            data.trip.endDate,
          ),
        );
      }
      let attempts = 0;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      const focusTarget = () => {
        const target = document.getElementById(`contribution-${match[1]}`);
        if (!target && attempts < 10) {
          attempts += 1;
          frame = window.requestAnimationFrame(focusTarget);
          return;
        }
        if (!target) return;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("is-notification-target");
        timer = window.setTimeout(
          () => target.classList.remove("is-notification-target"),
          2_800,
        );
      };
      frame = window.requestAnimationFrame(focusTarget);
    };
    revealContribution();
    window.addEventListener("hashchange", revealContribution);
    window.addEventListener(NOTIFICATION_NAVIGATION_EVENT, revealContribution);
    return () => {
      window.removeEventListener("hashchange", revealContribution);
      window.removeEventListener(
        NOTIFICATION_NAVIGATION_EVENT,
        revealContribution,
      );
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [
    data.itinerary,
    data.trip.endDate,
    data.trip.slug,
    data.trip.startDate,
    suggestions,
  ]);
  const sourceMap = useMemo(
    () => new Map(data.sources.map((source) => [source.number, source])),
    [data.sources],
  );
  const suggestionsByActivity = useMemo(() => {
    const grouped = new Map();
    for (const suggestion of suggestions) {
      const key = suggestion.activityId || "trip";
      grouped.set(key, [...(grouped.get(key) || []), suggestion]);
    }
    return grouped;
  }, [suggestions]);
  const resolvedState = itinerary.length
    ? getTripTrackerState(now, itinerary)
    : null;
  const liveDay = scheduleSectionForDate(
    resolvedState?.anchor?.startDate || data.trip.startDate,
    data.trip.startDate,
    data.trip.endDate,
  );
  useEffect(() => {
    setSelectedDay((current) =>
      current === previousLiveDayRef.current ? liveDay : current,
    );
    previousLiveDayRef.current = liveDay;
  }, [liveDay]);
  useEffect(() => {
    daySelectorRef.current
      ?.querySelector(`[data-trip-day="${selectedDay}"]`)
      ?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "nearest",
        inline: "nearest",
      });
  }, [selectedDay]);
  const tripDays = useMemo(
    () => enumerateTripDays(data.trip.startDate, data.trip.endDate),
    [data.trip.endDate, data.trip.startDate],
  );
  const scheduleSections = useMemo(() => {
    const preparationCount = itinerary.filter(
      (item) => item.startDate < data.trip.startDate,
    ).length;
    const postTripCount = itinerary.filter(
      (item) => item.startDate > data.trip.endDate,
    ).length;
    return [
      ...(preparationCount
        ? [{
            key: PREPARATION_SECTION,
            kicker: t("tracker.beforeTrip"),
            label: t("tracker.preparation"),
            count: preparationCount,
          }]
        : []),
      ...tripDays.map((date, index) => ({
        key: date,
        kicker: t("tracker.day", { number: index + 1 }),
        label: formatDateLabel(
          date,
          data.trip.timezone,
          { weekday: "short", day: "2-digit", month: "2-digit" },
          intlLocale,
        ),
        count: itinerary.filter((item) => item.startDate === date).length,
      })),
      ...(postTripCount
        ? [{
            key: POST_TRIP_SECTION,
            kicker: t("tracker.afterTrip"),
            label: t("tracker.postTrip"),
            count: postTripCount,
          }]
        : []),
    ];
  }, [data.trip, intlLocale, itinerary, t, tripDays]);
  const selectedItinerary = useMemo(
    () =>
      itinerary.filter(
        (item) =>
          scheduleSectionForDate(
            item.startDate,
            data.trip.startDate,
            data.trip.endDate,
          ) === selectedDay,
      ),
    [data.trip, itinerary, selectedDay],
  );
  const browsingDay = selectedDay !== liveDay;
  const previewItem = selectedItinerary[0] || null;
  const displayState =
    browsingDay && previewItem
      ? {
          mode: "preview",
          current: previewItem,
          anchor: previewItem,
          index: -1,
          next: selectedItinerary[1] || null,
        }
      : resolvedState;
  const tripTitle = formatTripTitle(
    data.trip.title,
    data.trip.startDate,
    data.trip.timezone,
    now,
    data.trip.endDate,
    locale,
  );
  const pageTitle = getTripPageTitle({
    mode: resolvedState?.mode,
    tripTitle,
    activityTitle: resolvedState?.current?.title,
    locale,
  });

  useEffect(() => {
    const applyTitle = () => {
      if (document.title !== pageTitle) document.title = pageTitle;
    };

    applyTitle();
    const headObserver = new MutationObserver(applyTitle);
    headObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => headObserver.disconnect();
  }, [pageTitle]);

  useLayoutEffect(() => {
    const list = routeListRef.current;
    const active = activeStopRef.current;
    const stage = stationStageRef.current;
    const station = stage?.querySelector(".now-station");
    if (!list || !active || !stage || !station) return;

    const mobileQuery = window.matchMedia("(max-width: 680px)");
    const syncConnection = () => {
      if (mobileQuery.matches) return;

      const activeRect = active.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const stationRect = station.getBoundingClientRect();
      const activeCenter = activeRect.top + activeRect.height / 2;
      const connectionY = Math.max(
        28,
        Math.min(stageRect.height - 28, activeCenter - stageRect.top),
      );
      const notchY = Math.max(
        28,
        Math.min(stationRect.height - 28, activeCenter - stationRect.top),
      );
      const isVisible =
        activeCenter >= listRect.top && activeCenter <= listRect.bottom;

      stage.style.setProperty("--route-connection-y", `${connectionY}px`);
      stage.style.setProperty(
        "--route-connection-opacity",
        isVisible ? "1" : "0",
      );
      station.style.setProperty("--station-notch-y", `${notchY}px`);
      station.style.setProperty(
        "--station-notch-depth",
        isVisible ? "18px" : "0px",
      );
    };

    const align = () => {
      if (mobileQuery.matches) return;
      const activeRect = active.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      list.scrollTop +=
        activeRect.top +
        activeRect.height / 2 -
        (stageRect.top + stageRect.height / 2);
      syncConnection();
    };

    align();
    list.addEventListener("scroll", syncConnection, { passive: true });
    window.addEventListener("resize", align);
    const resizeObserver = new ResizeObserver(syncConnection);
    resizeObserver.observe(active);
    resizeObserver.observe(stage);
    resizeObserver.observe(station);

    return () => {
      list.removeEventListener("scroll", syncConnection);
      window.removeEventListener("resize", align);
      resizeObserver.disconnect();
    };
  }, [displayState?.anchor?.id, selectedItinerary.length]);

  const clock = new Intl.DateTimeFormat(intlLocale, {
    timeZone: data.trip.timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  const tripDateLabel = formatTripDateRange(data.trip, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }, intlLocale);
  const tripHeader = (
      <header className={navigationStyles["trip-bar"]} id="top">
        <a
          className={navigationStyles["product-mark"]}
          href="#top"
          aria-label={t("common.backToTrip")}
        >
          <TypeIcon type="Transit" />
          <span>{t("app.title")}</span>
        </a>
        <div className={navigationStyles["trip-context"]}>
          <label className={navigationStyles["trip-picker"]}>
            <span className="sr-only">{t("nav.selectTrip")}</span>
            <span className={navigationStyles["trip-picker-control"]}>
              <select
                value={data.trip.slug}
                onChange={(event) => {
                  const nextSlug = event.target.value;
                  guardScheduleDraft(
                    () => {
                      const url = new URL(window.location.href);
                      url.searchParams.set("trip", nextSlug);
                      router.push(`/${url.search}`);
                    },
                    t("adminExtra.message003", {
                      value0:
                        scheduleEditor?.values.title ||
                        t("adminExtra.message004"),
                    }),
                  );
                }}
              >
                {trips.map((trip) => (
                  <option value={trip.slug} key={trip.slug}>
                    {formatTripTitle(
                      trip.title,
                      trip.startDate,
                      trip.timezone,
                      now,
                      trip.endDate,
                      locale,
                    )}
                  </option>
                ))}
              </select>
              <span
                className={navigationStyles["trip-picker-affordance"]}
                aria-hidden="true"
              >
                <span>{t("nav.change")}</span>
                <ActionIcon name="down" />
              </span>
            </span>
            <small>
              {tripDateLabel} · {data.trip.location}
            </small>
          </label>
          <div className={navigationStyles["trip-context-actions"]}>
            <AssistantLauncher tripSlug={data.trip.slug} />
            {access?.canManageMembers && <button
              className={`${navigationStyles["admin-link"]} ${navigationStyles["invite-link"]}`}
              type="button"
              onClick={() => setInvitationOpen(true)}
            >
              <ActionIcon name="invite" />
              <span>{t("nav.invite")}</span>
            </button>}
            <button
              className={`${navigationStyles["admin-link"]} ${navigationStyles["invite-link"]}`}
              type="button"
              onClick={() => setMembersOpen(true)}
            >
              <ActionIcon name="invite" />
              <span>{t("visibility.members")}</span>
            </button>
          </div>
        </div>
        <div className={navigationStyles["viewer-utilities"]}>
          <LanguageSwitcher />
          {access?.canManage && (
            <Link
              className={`${navigationStyles["admin-link"]} ${trackerStyles["desktop-manage-link"]}`}
              href={`/trips/manage?trip=${encodeURIComponent(data.trip.slug)}`}
            >
              {t("common.manage")}
            </Link>
          )}
          {viewer && <NotificationCenter />}
          {viewer ? (
            <ViewerMenu viewer={viewer} />
          ) : (
            <button
              className={`${navigationStyles["admin-link"]} ${navigationStyles["user-link"]}`}
              type="button"
              onClick={() => signIn("google", { redirectTo: "/" })}
            >
              {t("common.login")}
            </button>
          )}
        </div>
        <div
          className={trackerStyles["live-clock"]}
          aria-label={t("nav.currentTimeAt", { timezone: data.trip.timezone })}
        >
          <span className={trackerStyles["live-dot"]} aria-hidden="true" />
          <small>
            {data.trip.timezone === "Asia/Tokyo" ? "JST" : data.trip.timezone}
          </small>
          <span>{clock}</span>
        </div>
      </header>
  );
  const invitation = invitationOpen && (
        <InvitationDialog
          open
          onClose={() => {
            setInvitationOpen(false);
            setGmailReturn(false);
          }}
          viewer={viewer}
          trip={data.trip}
          itinerary={data.itinerary}
          gmailReturn={gmailReturn}
        />
      );
  const memberPanel = membersOpen && <TripMembersPanel trip={data.trip} access={access} onClose={() => setMembersOpen(false)} />;
  const tripSupplement = <>
      <ExpenseSummary ledger={expenseLedger} />
      <section
        className={contributionsStyles["trip-suggestions"]}
        aria-labelledby="trip-suggestions-title"
      >
        <h2 id="trip-suggestions-title">{t("tracker.notesForTrip")}</h2>
        <button
          className={trackerStyles["jump-button"]}
          type="button"
          onClick={() => openSuggestion(null, t("trackerExtra.wholeTrip"))}
        >
          {t("tracker.addNote")}
        </button>
        <SuggestionList
          suggestions={suggestionsByActivity.get("trip") || []}
          {...suggestionListProps}
        />
      </section>

      <SavedPlaces places={data.places} activities={data.itinerary} />

      <section
        className={contributionsStyles["sources"]}
        aria-labelledby="sources-title"
      >
        <div className={`${trackerStyles["section-heading"]} compact`}>
          <h2 id="sources-title">{t("tracker.placeSources")}</h2>
        </div>
        <div className={contributionsStyles["source-list"]}>
          {data.sources.map((source) => (
            <a
              className={contributionsStyles["source-card"]}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              key={source.number}
            >
              <span className={contributionsStyles["source-number"]}>
                {String(source.number).padStart(2, "0")}
              </span>
              <span>
                <strong>{source.title}</strong>
                <small>{source.host}</small>
              </span>
              <span className="source-arrow">
                <ActionIcon name="external" />
              </span>
            </a>
          ))}
        </div>
      </section>
      <Footer>
        <span>{tripTitle}</span>
        <span>{t("trackerExtra.footer")}</span>
      </Footer>

      {contributionDialogs}
      {discardDialog}
      {activityToDelete && (
        <ConfirmDialog
          title={t("adminExtra.message021")}
          description={t("adminExtra.message237", {
            value0: activityToDelete.title,
          })}
          preview={activityToDelete.title}
          confirmLabel={t("adminExtra.message033")}
          pendingLabel={t("adminExtra.message070")}
          pending={scheduleBusy}
          error={scheduleDeleteError}
          onCancel={() => {
            if (scheduleBusy) return;
            setActivityToDelete(null);
            setScheduleDeleteError("");
          }}
          onConfirm={deleteScheduleItem}
        />
      )}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {invitation}
      {memberPanel}
  </>;
  if (!itinerary.length) {
    return (
      <main className="shell">
        {tripHeader}
        {scheduleNotice && (
          <p className={trackerStyles["schedule-notice"]} role="status">
            {scheduleNotice}
            <button
              type="button"
              aria-label={t("adminExtra.message027")}
              onClick={() => setScheduleNotice("")}
            >
              <ActionIcon name="close" />
            </button>
          </p>
        )}
        <section className="now-card error-card">
          <h1>{t("tracker.noActivities")}</h1>
          <p>{t("tracker.noActivitiesDescription")}</p>
          <div className={trackerStyles["empty-schedule-actions"]}>
            <Link className={trackerStyles["jump-button"]} href="/">
              {t("tracker.chooseTrip")}
            </Link>
            {access?.canManage && (
              <Button
                variant="primary"
                type="button"
                aria-expanded={scheduleEditor?.key === "new"}
                aria-controls="schedule-editor-new"
                onClick={(event) =>
                  openNewScheduleEditor(event.currentTarget)
                }
              >
                {t("adminExtra.message042")}
              </Button>
            )}
          </div>
        </section>
        {access?.canManage && scheduleEditor?.key === "new" && (
          <div className={trackerStyles["public-schedule-editor"]}>
            <ScheduleForm
              key="new"
              editor={scheduleEditor}
              busy={scheduleBusy}
              error={scheduleError}
              sources={data.sources}
              placement="create"
              onChange={(values) =>
                setScheduleEditor((current) =>
                  current ? { ...current, values } : current,
                )
              }
              onCreateSource={createScheduleSource}
              onSave={saveSchedule}
              onCancel={closeScheduleEditor}
            />
          </div>
        )}
        {tripSupplement}
      </main>
    );
  }
  const state = displayState || resolvedState;

  let countdown;
  let progress = 0;
  let status;
  let kicker;
  let title;
  let detail;
  let range;
  let countdownLabel;

  if (state.mode === "preview") {
    status = t("tracker.previewing");
    kicker =
      selectedDay === PREPARATION_SECTION
        ? t("tracker.preparation")
        : selectedDay === POST_TRIP_SECTION
          ? t("tracker.postTrip")
          : t("tracker.day", { number: tripDays.indexOf(selectedDay) + 1 });
    title = state.current.title;
    detail = state.current.detail;
    range = `${state.current.start} — ${state.current.endDate !== state.current.startDate ? `${formatDateLabel(state.current.endDate, data.trip.timezone, { weekday: "short", day: "2-digit", month: "2-digit" }, intlLocale)} · ` : ""}${state.current.displayEnd || state.current.end}`;
  } else if (state.mode === "before") {
    countdown = formatDuration(state.current.startAt - now, t);
    status = t("tracker.status.before");
    kicker = t("tracker.tripStartsIn");
    title = state.current.title;
    detail = state.current.detail;
    range = t("trackerExtra.startsAt", { time: state.current.start });
    countdownLabel = t("tracker.untilDeparture");
  } else if (state.mode === "after") {
    status = t("tracker.status.after");
    kicker = t("tracker.tripComplete");
    title = t("tracker.tripCompleted");
    detail = t("tracker.activitiesPassed", { count: itinerary.length });
    range = t("tracker.completedAt", { time: state.anchor.end });
  } else {
    const item = state.current;
    const target = state.mode === "gap" ? item.startAt : item.endAt;
    countdown = formatDuration(target - now, t);
    progress =
      state.mode === "active"
        ? (now - item.startAt) / (item.endAt - item.startAt)
        : 0;
    status = state.mode === "gap"
      ? t("tracker.status.gap")
      : t("tracker.status.active", { type: translateActivityType(locale, item.type) });
    kicker = state.mode === "gap" ? t("tracker.nextActivity") : t("tracker.current");
    title = item.title;
    detail = item.detail;
    range = `${item.start} — ${item.endDate !== item.startDate ? `${formatDateLabel(item.endDate, data.trip.timezone, { weekday: "short", day: "2-digit", month: "2-digit" }, intlLocale)} · ` : ""}${item.displayEnd || item.end}`;
    countdownLabel = state.mode === "gap" ? t("tracker.untilActivity") : t("tracker.remaining");
  }

  const scheduleHeading = browsingDay
    ? selectedDay === PREPARATION_SECTION
      ? t("tracker.preparation")
      : selectedDay === POST_TRIP_SECTION
        ? t("tracker.postTrip")
        : `${t("tracker.day", { number: tripDays.indexOf(selectedDay) + 1 })} · ${formatDateLabel(selectedDay, data.trip.timezone, { weekday: "long", day: "2-digit", month: "2-digit" }, intlLocale)}`
    : formatScheduleHeading(
        data.trip.startDate,
        data.trip.timezone,
        now,
        data.trip.endDate,
        locale,
      );
  const activeReservationContacts = state.current?.reservationContacts || [];
  const isAfter = state.mode === "after";
  const isPreview = state.mode === "preview";
  const showCountdown = !isAfter && !isPreview;
  const jumpLabel = browsingDay
    ? t("tracker.backToCurrent")
    : isAfter
      ? t("tracker.end")
      : t("tracker.now");
  const stationSuggestionActivityId = isAfter ? null : state.current.id;
  const stationSuggestionTarget = isAfter
    ? t("trackerExtra.wholeTrip")
    : state.current.title;
  const stationSuggestionKey = stationSuggestionActivityId || "trip";
  const stationSuggestionLabel = isAfter
    ? t("tracker.addTripNote")
    : t("tracker.addActivityNote");

  const jumpToCurrent = () => {
    const targetState = resolvedState;
    const target =
      targetState.mode === "after"
        ? targetState.anchor.id
        : targetState.anchor.id;
    setSelectedDay(liveDay);
    requestAnimationFrame(() =>
      document
        .getElementById(target)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };

  const selectPublicBranch = async (group, branch) => {
    const tripStarted = now >= itinerary[0].startAt;
    if (
      tripStarted &&
      !window.confirm(
        t("trackerExtra.branchConfirm", { label: branch.label }),
      )
    )
      return;
    setBranchAction({ id: branch.id, error: "" });
    try {
      const response = await fetch(
        `/api/trips/${encodeURIComponent(data.trip.slug)}/branches/${group.id}/selection`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ branchId: branch.id }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(t("trackerExtra.branchError"));
      setData(result);
      setBranchAction({ id: null, error: "" });
      setAnnouncement(t("trackerExtra.branchSelected", { label: branch.label }));
    } catch {
      setBranchAction({
        id: branch.id,
        error: t("trackerExtra.retry", { error: t("trackerExtra.branchError") }),
      });
    }
  };

  const startBranchGroup =
    (data.branchGroups || []).find((group) => group.anchorActivityId == null) ||
    null;
  const branchGroupsByAnchor = new Map(
    (data.branchGroups || [])
      .filter((group) => group.anchorActivityId != null)
      .map((group) => [group.anchorActivityId, group]),
  );
  const selectedLast = selectedItinerary.at(-1);
  const stationNext =
    state.next ||
    (selectedLast
      ? itinerary.find(
          (item) =>
            item.startAt >= selectedLast.endAt && item.id !== selectedLast.id,
        )
      : null);
  const navigateToActivity = (item) => {
    if (!item) return;
    setSelectedDay(
      scheduleSectionForDate(
        item.startDate,
        data.trip.startDate,
        data.trip.endDate,
      ),
    );
    requestAnimationFrame(() =>
      document
        .getElementById(item.id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };

  return (
    <main className="shell" data-trip-mode={state.mode}>
      {tripHeader}

      <nav
        className={trackerStyles["trip-day-selector"]}
        aria-label={t("tracker.chooseDay")}
        ref={daySelectorRef}
      >
        {scheduleSections.map((section) => {
          return (
            <button
              key={section.key}
              type="button"
              data-trip-day={section.key}
              aria-current={selectedDay === section.key ? "date" : undefined}
              onClick={(event) =>
                selectTripDay(section.key, event.currentTarget)
              }
            >
              <span>{section.kicker}</span>
              <strong>{section.label}</strong>
              <small>{section.count ? t("tracker.activities", { count: section.count }) : t("tracker.noSchedule")}</small>
            </button>
          );
        })}
      </nav>

      {!selectedItinerary.length && (
        <section className={trackerStyles["empty-trip-day"]} aria-live="polite">
          <span className={trackerStyles["route-node"]} aria-hidden="true" />
          <div>
            <h1>{t("tracker.emptyDayTitle")}</h1>
            <p>
              {t("trackerExtra.emptyDay")}
            </p>
          </div>
          {browsingDay && (
            <button
              type="button"
              className={trackerStyles["jump-button"]}
              onClick={jumpToCurrent}
            >
              {t("tracker.backToCurrent")}
            </button>
          )}
        </section>
      )}

      {selectedItinerary.length > 0 && (
        <section
          className={trackerStyles["live-board"]}
          aria-label={
            browsingDay
              ? t("tracker.previewing")
              : t("tracker.currentRoute")
          }
        >
          <aside className={trackerStyles["route-overview"]}>
            <div className={trackerStyles["route-overview-head"]}>
              <h2>{scheduleHeading}</h2>
              <button type="button" onClick={jumpToCurrent}>
                {jumpLabel}
              </button>
            </div>
            <ol className={trackerStyles["route-stops"]} ref={routeListRef}>
              {selectedItinerary.map((item) => {
                const isFocused = item.id === state.anchor.id;
                const isDone = item.endAt <= now;
                const isTerminus = isAfter && isFocused;
                const branchGroup = branchGroupsByAnchor.get(item.id);
                return (
                  <li
                    className={`${isFocused && !isAfter ? "is-active" : ""}${isDone ? " is-done" : ""}${isTerminus ? " is-terminus" : ""}`}
                    ref={isFocused ? activeStopRef : null}
                    key={item.id}
                  >
                    <a href={`#${item.id}`}>
                      <time>{item.start}</time>
                      <span
                        className={trackerStyles["route-node"]}
                        aria-hidden="true"
                      />
                      <span className={trackerStyles["route-stop-copy"]}>
                        <strong>{item.title}</strong>
                        <small>
                          {item.branchLabel
                            ? `${translateActivityType(locale, item.type)} · ${item.branchLabel}`
                            : translateActivityType(locale, item.type)}
                          {branchGroup
                            ? ` · ${t("trackerExtra.options", { count: branchGroup.branches.length })}`
                            : ""}
                        </small>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ol>
          </aside>

          <div className={trackerStyles["station-stage"]} ref={stationStageRef}>
            <p className="sr-only" role="status" aria-live="polite">
              {status}: {title}. {range}
            </p>
            <section
              className={trackerStyles["now-station"]}
              data-mode={state.mode}
            >
              <div className={trackerStyles["station-status"]}>
                <span>{kicker}</span>
                <strong>{status}</strong>
              </div>
              <div className={trackerStyles["station-main"]}>
                <div className={trackerStyles["station-copy"]}>
                  <span
                    className={trackerStyles["station-icon"]}
                    aria-hidden="true"
                  >
                    {isAfter ? (
                      <ActionIcon name="check" />
                    ) : (
                      <TypeIcon type={state.current.type} />
                    )}
                  </span>
                  <div>
                    <h1>{title}</h1>
                    <p className={trackerStyles["station-range"]}>{range}</p>
                  </div>
                </div>
                {showCountdown && (
                  <div className={trackerStyles["countdown-wrap"]}>
                    <span>{countdownLabel}</span>
                    <strong>{countdown.value}</strong>
                    <small>{countdown.unit}</small>
                    <i
                      className={trackerStyles["countdown-progress"]}
                      style={{ "--progress": Math.min(1, progress) }}
                      aria-hidden="true"
                    />
                  </div>
                )}
              </div>
              {(detail || activeReservationContacts.length > 0) && (
                <ActivityDetail detail={detail} contacts={activeReservationContacts} placement="station" />
              )}
              {!isAfter && state.current.refs.length > 0 && (
                <div className={trackerStyles["citations"]}>
                  {state.current.refs.map((ref) => (
                    <Citation key={ref} source={sourceMap.get(ref)} />
                  ))}
                </div>
              )}
              <div className={trackerStyles["station-actions"]}>
                <button
                  type="button"
                  onClick={() =>
                    openSuggestion(
                      stationSuggestionActivityId,
                      stationSuggestionTarget,
                    )
                  }
                >
                          {viewer ? stationSuggestionLabel : t("tracker.loginToComment")}
                </button>
                <span>
                  {
                    (suggestionsByActivity.get(stationSuggestionKey) || [])
                      .length
                  }{" "}
                  {t("trackerExtra.notes")}
                </span>
              </div>
              <SuggestionList
                suggestions={
                  suggestionsByActivity.get(stationSuggestionKey) || []
                }
                anchorItems={false}
                {...suggestionListProps}
              />
            </section>

            {stationNext && (
              <a
                className={trackerStyles["next-station"]}
                href={`#${stationNext.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigateToActivity(stationNext);
                }}
              >
                <span>{t("common.next")}</span>
                <TypeIcon type={stationNext.type} />
                <strong>{stationNext.title}</strong>
                <small>
                  {stationNext.startDate !== selectedDay
                    ? `${formatDateLabel(stationNext.startDate, data.trip.timezone, { weekday: "short", day: "2-digit", month: "2-digit" }, intlLocale)} · `
                    : ""}
                  {stationNext.start} ·{" "}
                  {stationNext.branchLabel || translateActivityType(locale, stationNext.type)}
                </small>
                <ActionIcon name="right" />
              </a>
            )}

            <div className={trackerStyles["station-legend"]}>
              <span>
                <i className={`${trackerStyles["legend-line"]} active`} /> {t("trackerExtra.current")}
              </span>
              <span>
                <i className={`${trackerStyles["legend-line"]} next`} /> {t("common.next")}
              </span>
              <span>
                <i className={`${trackerStyles["legend-line"]} done`} /> {t("trackerExtra.passed")}
              </span>
            </div>
          </div>
        </section>
      )}

      {selectedItinerary.length > 0 && (
        <section
          className={trackerStyles["mobile-route-board"]}
          aria-label={t("tracker.currentRoute")}
        >
          <div className={trackerStyles["mobile-route-head"]}>
            <h2>{scheduleHeading}</h2>
            <button type="button" onClick={jumpToCurrent}>
              {jumpLabel}
            </button>
          </div>
          <ol>
            {selectedItinerary.map((item) => {
              const isFocused = item.id === state.anchor.id;
              const isDone = item.endAt <= now;
              const isTerminus = isAfter && isFocused;
              return (
                <li
                  className={`${trackerStyles["mobile-route-stop"]}${isFocused && !isAfter ? " is-active" : ""}${isDone ? " is-done" : ""}${isTerminus ? " is-terminus" : ""}`}
                  key={item.id}
                >
                  <a
                    className={trackerStyles["mobile-stop-label"]}
                    href={`#${item.id}`}
                  >
                    <time>{item.start}</time>
                    <i aria-hidden="true" />
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {item.branchLabel
                          ? `${translateActivityType(locale, item.type)} · ${item.branchLabel}`
                          : translateActivityType(locale, item.type)}
                      </small>
                    </span>
                  </a>
                  {isFocused && (
                    <section className={trackerStyles["mobile-active-foldout"]}>
                      <div className={trackerStyles["mobile-foldout-status"]}>
                        <span>{kicker}</span>
                        <strong>{status}</strong>
                      </div>
                      <div className={trackerStyles["mobile-foldout-title"]}>
                        {isAfter ? (
                          <ActionIcon name="check" />
                        ) : (
                          <TypeIcon type={item.type} />
                        )}
                        <h1>{title}</h1>
                      </div>
                      <p className={trackerStyles["mobile-foldout-range"]}>
                        {range}
                      </p>
                      {showCountdown && (
                        <div
                          className={trackerStyles["mobile-foldout-countdown"]}
                        >
                          <span>{countdownLabel}</span>
                          <strong>{countdown.value}</strong>
                          <small>{countdown.unit}</small>
                        </div>
                      )}
                      {(detail || item.reservationContacts?.length > 0) && (
                        <ActivityDetail detail={detail} contacts={item.reservationContacts} placement="mobile" />
                      )}
                      {!isAfter && item.refs.length > 0 && (
                        <div className={trackerStyles["citations"]}>
                          {item.refs.map((ref) => (
                            <Citation key={ref} source={sourceMap.get(ref)} />
                          ))}
                        </div>
                      )}
                      <div className={trackerStyles["station-actions"]}>
                        <button
                          type="button"
                          onClick={() =>
                            openSuggestion(
                              stationSuggestionActivityId,
                              stationSuggestionTarget,
                            )
                          }
                        >
                          {viewer
                            ? stationSuggestionLabel
                            : t("tracker.loginToComment")}
                        </button>
                        <span>
                          {
                            (
                              suggestionsByActivity.get(stationSuggestionKey) ||
                              []
                            ).length
                          }{" "}
                          {t("trackerExtra.notes")}
                        </span>
                      </div>
                      {stationNext && (
                        <a
                          className={trackerStyles["mobile-next-fascia"]}
                          href={`#${stationNext.id}`}
                          onClick={(event) => {
                            event.preventDefault();
                            navigateToActivity(stationNext);
                          }}
                        >
                          <span>
                            {t("common.next")} ·{" "}
                            {stationNext.startDate !== selectedDay
                              ? `${formatDateLabel(stationNext.startDate, data.trip.timezone, { weekday: "short", day: "2-digit", month: "2-digit" }, intlLocale)} · `
                              : ""}
                            {stationNext.start}
                            {stationNext.branchLabel
                              ? ` · ${stationNext.branchLabel}`
                              : ""}
                          </span>
                          <strong>{stationNext.title}</strong>
                          <ActionIcon name="right" />
                        </a>
                      )}
                    </section>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {resolvedState.mode !== "after" && (
        <button
          className={trackerStyles["mobile-live-dock"]}
          type="button"
          onClick={jumpToCurrent}
        >
          <span>
            <small>{browsingDay ? t("tracker.backToCurrent") : status}</small>
            <strong>{resolvedState.anchor.title}</strong>
          </span>
          {resolvedState.next && (
            <span>
              <small>{t("common.next")} · {resolvedState.next.start}</small>
              <strong>{resolvedState.next.title}</strong>
            </span>
          )}
          <ActionIcon name="right" />
        </button>
      )}

      <div className={trackerStyles["section-heading"]}>
        <h2>{t("tracker.fullSchedule")}</h2>
        <div className={trackerStyles["schedule-heading-actions"]}>
          {access?.canManage && (
            <Button
              variant="primary"
              type="button"
              aria-expanded={scheduleEditor?.key === "new"}
              aria-controls="schedule-editor-new"
              onClick={(event) => openNewScheduleEditor(event.currentTarget)}
            >
              {t("adminExtra.message046")}
            </Button>
          )}
          <button
            className={trackerStyles["jump-button"]}
            type="button"
            onClick={jumpToCurrent}
          >
            {isAfter ? t("tracker.backToEnd") : t("tracker.backToCurrent")} <ActionIcon name="down" />
          </button>
        </div>
      </div>

      {scheduleNotice && (
        <p className={trackerStyles["schedule-notice"]} role="status">
          {scheduleNotice}
          <button
            type="button"
            aria-label={t("adminExtra.message027")}
            onClick={() => setScheduleNotice("")}
          >
            <ActionIcon name="close" />
          </button>
        </p>
      )}

      {access?.canManage && scheduleEditor?.key === "new" && (
        <div className={trackerStyles["public-schedule-editor"]}>
          <ScheduleForm
            key="new"
            editor={scheduleEditor}
            busy={scheduleBusy}
            error={scheduleError}
            sources={data.sources}
            placement="create"
            onChange={(values) =>
              setScheduleEditor((current) =>
                current ? { ...current, values } : current,
              )
            }
            onCreateSource={createScheduleSource}
            onSave={saveSchedule}
            onCancel={closeScheduleEditor}
          />
        </div>
      )}

      {selectedItinerary.length > 0 && (
        <section
          className={trackerStyles["timeline"]}
          aria-label={t("trackerExtra.detailSchedule", {
            date:
              selectedDay === PREPARATION_SECTION
                ? t("tracker.preparation")
                : selectedDay === POST_TRIP_SECTION
                  ? t("tracker.postTrip")
                  : selectedDay,
          })}
        >
          {selectedDay === data.trip.startDate && startBranchGroup && (
            <div className={trackerStyles["trip-start-junction"]}>
              <BranchJunction
                group={startBranchGroup}
                startsTrip
                viewer={viewer}
                canSelectBranch={access?.canSelectBranch}
                sourceMap={sourceMap}
                suggestionsByActivity={suggestionsByActivity}
                suggestionListProps={suggestionListProps}
                expenseLedger={expenseLedger}
                branchAction={branchAction}
                onSelect={selectPublicBranch}
                onSuggest={openSuggestion}
              />
            </div>
          )}
          {selectedItinerary.map((item) => {
            const isCurrent =
              resolvedState.mode === "active" &&
              item.id === resolvedState.current.id;
            const isDone = item.endAt <= now;
            const branchGroup = branchGroupsByAnchor.get(item.id);
            return (
              <div className={trackerStyles["timeline-segment"]} key={item.id}>
                <article
                  className={`${trackerStyles["timeline-item"]}${isCurrent ? " is-current" : ""}${isDone ? " is-done" : ""}`}
                  id={item.id}
                >
                  <div className={trackerStyles["timeline-time"]}>
                    <strong>{item.start}</strong>
                    <span>{item.displayEnd || item.end}</span>
                  </div>
                  <div className={trackerStyles["timeline-rail"]}>
                    <span
                      className={trackerStyles["timeline-dot"]}
                      aria-hidden="true"
                    />
                  </div>
                  <div className={trackerStyles["timeline-card"]}>
                    <div className={trackerStyles["timeline-card-head"]}>
                      <span className={trackerStyles["type-label"]}>
                        <TypeIcon type={item.type} />
                        {translateActivityType(locale, item.type)}
                        {item.branchLabel ? ` · ${item.branchLabel}` : ""}
                      </span>
                      <div className={trackerStyles["timeline-card-controls"]}>
                        <span className={trackerStyles["done-label"]}>
                          {t("trackerExtra.passed")}
                        </span>
                        {access?.canManage && (
                          <div className={trackerStyles["timeline-owner-actions"]}>
                            <Button
                              variant="ghost"
                              type="button"
                              disabled={scheduleBusy}
                              aria-expanded={
                                scheduleEditor?.key === String(item.id)
                              }
                              aria-controls={`schedule-editor-${item.id}`}
                              onClick={(event) =>
                                activateScheduleEditor(
                                  item,
                                  event.currentTarget,
                                )
                              }
                            >
                              {scheduleEditor?.key === String(item.id)
                                ? t("adminExtra.message072")
                                : t("adminExtra.message037")}
                            </Button>
                            <Button
                              variant="danger"
                              type="button"
                              disabled={scheduleBusy}
                              onClick={() => requestScheduleDelete(item)}
                            >
                              {t("adminExtra.message033")}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                    <h3>{item.title}</h3>
                    {(item.detail || item.reservationContacts?.length > 0) && (
                      <ActivityDetail
                        detail={item.detail}
                        contacts={item.reservationContacts}
                        placement="timeline"
                      />
                    )}
                    {item.refs.length > 0 && (
                      <div className={trackerStyles["citations"]}>
                        {item.refs.map((ref) => (
                          <Citation key={ref} source={sourceMap.get(ref)} />
                        ))}
                      </div>
                    )}
                    <SuggestionList
                      suggestions={suggestionsByActivity.get(item.id) || []}
                      {...suggestionListProps}
                    />
                    <ActivityExpenses activity={item} ledger={expenseLedger} />
                    <button
                      className={contributionsStyles["suggestion-trigger"]}
                      type="button"
                      onClick={() => openSuggestion(item.id, item.title)}
                    >
                      {viewer
                        ? t("tracker.addActivityNote")
                        : t("tracker.loginToComment")}
                    </button>
                  </div>
                  {access?.canManage &&
                    scheduleEditor?.key === String(item.id) && (
                      <ScheduleForm
                        key={scheduleEditor.key}
                        editor={scheduleEditor}
                        busy={scheduleBusy}
                        error={scheduleError}
                        sources={data.sources}
                        placement="inline"
                        onChange={(values) =>
                          setScheduleEditor((current) =>
                            current ? { ...current, values } : current,
                          )
                        }
                        onCreateSource={createScheduleSource}
                        onSave={saveSchedule}
                        onCancel={closeScheduleEditor}
                      />
                    )}
                </article>
                {branchGroup && (
                  <BranchJunction
                    group={branchGroup}
                    viewer={viewer}
                    canSelectBranch={access?.canSelectBranch}
                    sourceMap={sourceMap}
                    suggestionsByActivity={suggestionsByActivity}
                    suggestionListProps={suggestionListProps}
                    expenseLedger={expenseLedger}
                    branchAction={branchAction}
                    onSelect={selectPublicBranch}
                    onSuggest={openSuggestion}
                  />
                )}
              </div>
            );
          })}
        </section>
      )}

      {tripSupplement}
    </main>
  );
}

function BranchJunction({
  group,
  startsTrip = false,
  viewer,
  canSelectBranch,
  sourceMap,
  suggestionsByActivity,
  suggestionListProps,
  expenseLedger,
  branchAction,
  onSelect,
  onSuggest,
}) {
  const { t, locale } = useLocale();
  const selected =
    group.branches.find((branch) => branch.id === group.selectedBranchId) ||
    group.branches[0];
  const [expanded, setExpanded] = useState(false);
  const [openBranchIds, setOpenBranchIds] = useState(() => new Set());

  useEffect(() => {
    const revealBranchTarget = () => {
      const match = window.location.hash.match(/^#contribution-(\d+)$/);
      if (!match) return;
      for (const branch of group.branches) {
        if (branch.id === group.selectedBranchId) continue;
        const containsTarget = branch.itinerary.some((item) =>
          (suggestionsByActivity.get(item.id) || []).some(
            (suggestion) => suggestion.id === match[1],
          ),
        );
        if (containsTarget) {
          setExpanded(true);
          setOpenBranchIds((current) => new Set([...current, branch.id]));
        }
      }
    };
    revealBranchTarget();
    window.addEventListener("hashchange", revealBranchTarget);
    window.addEventListener(NOTIFICATION_NAVIGATION_EVENT, revealBranchTarget);
    return () => {
      window.removeEventListener("hashchange", revealBranchTarget);
      window.removeEventListener(
        NOTIFICATION_NAVIGATION_EVENT,
        revealBranchTarget,
      );
    };
  }, [group.branches, group.selectedBranchId, suggestionsByActivity]);

  const toggleBranch = (branchId) =>
    setOpenBranchIds((current) => {
      const next = new Set(current);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });

  return (
    <section
      className={`${trackerStyles["branch-junction"]}${startsTrip ? " is-trip-start" : ""}`}
      aria-labelledby={`public-branch-${group.id}`}
    >
      <button
        className={trackerStyles["branch-junction-summary"]}
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span
          className={trackerStyles["branch-switch-mark"]}
          aria-hidden="true"
        />
        <span>
          <small>
            {startsTrip ? t("trackerExtra.startJunction") : t("trackerExtra.junction")} ·{" "}
            {t("trackerExtra.options", { count: group.branches.length })}
          </small>
          <strong id={`public-branch-${group.id}`}>{group.title}</strong>
          <em>{t("trackerExtra.usingLabel", { label: selected.label })}</em>
        </span>
        <span className={expanded ? "is-open" : ""}>
          <ActionIcon name="down" />
        </span>
      </button>
      {expanded && (
        <div className={trackerStyles["branch-platforms"]}>
          {group.branches.map((branch) => {
            const isSelected = branch.id === selected.id;
            const open = openBranchIds.has(branch.id);
            return (
              <article
                className={`${trackerStyles["branch-platform"]}${isSelected ? " is-selected" : ""}`}
                key={branch.id}
              >
                <div className={trackerStyles["branch-platform-head"]}>
                  <button
                    type="button"
                    aria-expanded={isSelected || open}
                    onClick={() => {
                      if (!isSelected) toggleBranch(branch.id);
                    }}
                  >
                    <span>
                      {isSelected ? t("trackerExtra.using") : t("trackerExtra.backup")}
                      {branch.isDefault ? ` · ${t("trackerExtra.default")}` : ""}
                    </span>
                    <strong>{branch.label}</strong>
                    <small>{branch.condition}</small>
                  </button>
                  {canSelectBranch && !isSelected && (
                    <button
                      className={trackerStyles["branch-select-button"]}
                      type="button"
                      disabled={branchAction.id === branch.id}
                      onClick={() => onSelect(group, branch)}
                    >
                      {branchAction.id === branch.id
                        ? t("trackerExtra.switching")
                        : t("trackerExtra.useOption")}
                    </button>
                  )}
                </div>
                {branchAction.id === branch.id && branchAction.error && (
                  <p
                    className={trackerStyles["branch-action-error"]}
                    role="alert"
                  >
                    {branchAction.error}
                  </p>
                )}
                {isSelected && (
                  <p className={trackerStyles["branch-active-note"]}>
                    {t("trackerExtra.activeBranch")}
                  </p>
                )}
                {!isSelected && open && (
                  <div className={trackerStyles["branch-mini-route"]}>
                    {branch.itinerary.map((item) => (
                      <article
                        className={trackerStyles["branch-mini-stop"]}
                        id={item.id}
                        key={item.id}
                      >
                        <time>
                          {item.start}
                          <span>{item.displayEnd || item.end}</span>
                        </time>
                        <i aria-hidden="true" />
                        <div>
                          <span className={trackerStyles["type-label"]}>
                            <TypeIcon type={item.type} />
                            {translateActivityType(locale, item.type)}
                          </span>
                          <h4>{item.title}</h4>
                          {(item.detail || item.reservationContacts?.length > 0) && (
                            <ActivityDetail
                              detail={item.detail}
                              contacts={item.reservationContacts}
                              placement="branch"
                            />
                          )}
                          {item.refs.length > 0 && (
                            <div className={trackerStyles["citations"]}>
                              {item.refs.map((ref) => (
                                <Citation
                                  key={ref}
                                  source={sourceMap.get(ref)}
                                />
                              ))}
                            </div>
                          )}
                          <SuggestionList
                            suggestions={
                              suggestionsByActivity.get(item.id) || []
                            }
                            {...suggestionListProps}
                          />
                          <ActivityExpenses activity={item} ledger={expenseLedger} />
                          <button
                            className={
                              contributionsStyles["suggestion-trigger"]
                            }
                            type="button"
                            onClick={() => onSuggest(item.id, item.title)}
                          >
                            {viewer
                              ? t("trackerExtra.suggestActivity")
                              : t("trackerExtra.loginFeedback")}
                          </button>
                        </div>
                      </article>
                    ))}
                    {!branch.itinerary.length && (
                      <p className={trackerStyles["branch-empty"]}>
                        {t("trackerExtra.emptyBranch")}
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ActivityDetail({ detail, contacts: structuredContacts, placement }) {
  const hasStructuredContacts = structuredContacts?.length > 0;
  const contacts = hasStructuredContacts ? structuredContacts : parseContactDirectory(detail);
  const className =
    placement === "station"
      ? trackerStyles["now-detail"]
      : placement === "mobile"
        ? trackerStyles["mobile-foldout-detail"]
        : undefined;
  if (!contacts) {
    return detail ? <p className={className}>{detail}</p> : null;
  }
  return <>
    {hasStructuredContacts && detail ? <p className={className}>{detail}</p> : null}
    <ContactDirectory contacts={contacts} placement={placement} structured={hasStructuredContacts} />
  </>;
}

function ContactDirectory({ contacts, placement, structured = false }) {
  const { t } = useLocale();
  const [copyState, setCopyState] = useState({ phone: null, status: "idle" });
  const resetTimerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(resetTimerRef.current), []);

  const copyPhone = async (contact) => {
    window.clearTimeout(resetTimerRef.current);
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(contact.phone);
      setCopyState({ phone: contact.phone, status: "copied" });
    } catch {
      setCopyState({ phone: contact.phone, status: "error" });
    }
    resetTimerRef.current = window.setTimeout(
      () => setCopyState({ phone: null, status: "idle" }),
      2_000,
    );
  };

  return (
    <div
      className={`${trackerStyles["contact-directory"]} ${trackerStyles[`contact-directory-${placement}`]}`}
      aria-label={t(structured ? "trackerExtra.reservationContacts" : "trackerExtra.phones")}
    >
      {contacts.map((contact) => {
        const state =
          copyState.phone === contact.phone ? copyState.status : "idle";
        const buttonLabel =
          state === "copied"
            ? t("trackerExtra.copied")
            : state === "error"
              ? t("trackerExtra.copyError")
              : t("trackerExtra.copy");
        return (
          <div
            className={trackerStyles["contact-directory-row"]}
            key={`${contact.name}-${contact.phone || ""}-${contact.link || ""}`}
          >
            <span className={trackerStyles["contact-directory-name"]}>
              {contact.name}
            </span>
            {contact.phone ? <a
              className={trackerStyles["contact-directory-phone"]}
              href={`tel:${contact.dial || contact.phone.replace(/(?!^)\+/g, "").replace(/[^\d+]/g, "")}`}
              aria-label={t("trackerExtra.call", { name: contact.name, phone: contact.phone })}
            >{contact.phone}</a> : <span className={trackerStyles["contact-directory-empty"]} />}
            {contact.link ? <a
              className={trackerStyles["contact-directory-link"]}
              href={contact.link}
              target="_blank"
              rel="noreferrer"
              aria-label={t("trackerExtra.openReservationLink", { name: contact.name })}
            >
              {t("trackerExtra.reservationLink")}
              <ActionIcon name="external" />
            </a> : <span className={trackerStyles["contact-directory-empty"]} />}
            {contact.phone ? <button
              className={
                state === "copied"
                  ? "is-copied"
                  : state === "error"
                    ? "is-error"
                    : ""
              }
              type="button"
              aria-label={t("trackerExtra.copyPhoneName", { action: buttonLabel, name: contact.name })}
              title={t("trackerExtra.copyPhone", { action: buttonLabel })}
              onClick={() => copyPhone(contact)}
            >
              <ActionIcon name={state === "copied" ? "check" : "copy"} />
            </button> : <span className={trackerStyles["contact-directory-empty-action"]} />}
          </div>
        );
      })}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {copyState.status === "copied"
          ? t("trackerExtra.copiedPhone", { phone: copyState.phone })
          : copyState.status === "error"
            ? t("trackerExtra.failedPhone", { phone: copyState.phone })
            : ""}
      </span>
    </div>
  );
}

function Citation({ source }) {
  const { t } = useLocale();
  if (!source) return null;
  return (
    <a
      className={trackerStyles["citation"]}
      href={source.url}
      target="_blank"
      rel="noreferrer"
      aria-label={t("trackerExtra.openSource", { number: source.number })}
    >
      {t("trackerExtra.source", { number: source.number })}
      <ActionIcon name="external" />
    </a>
  );
}
