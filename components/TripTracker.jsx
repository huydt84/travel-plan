"use client";
import SavedPlaces from "./tracker/SavedPlaces";
import trackerStyles from "../src/styles/tracker.module.css";
import navigationStyles from "../src/styles/navigation.module.css";
import contributionsStyles from "../src/styles/contributions.module.css";

import { AssistantLauncher } from "./v1/AssistantProvider";
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
  activityInstants,
  enumerateTripDays,
  formatDateLabel,
  formatTripDateRange,
} from "../lib/trip-dates.mjs";
import { ActionIcon, TypeIcon } from "./Icons";
import { SuggestionList, useContributions } from "./tracker/Contributions";
import InvitationDialog from "./InvitationDialog";
import NotificationCenter from "./NotificationCenter";
import ViewerMenu from "./ViewerMenu";

const NOTIFICATION_NAVIGATION_EVENT = "travel-plan:notification-navigation";

const formatDuration = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0)
    return {
      value: `${hours}h ${String(minutes).padStart(2, "0")}`,
      unit: "giờ · phút",
    };
  return {
    value: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
    unit: "phút · giây",
  };
};

export default function TripTracker({
  initialData,
  initialNow,
  initialInvitationOpen = false,
  initialGmailReturn = false,
  viewer,
  trips,
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
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
  const [selectedDay, setSelectedDay] = useState(initialData.trip.startDate);
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
      if (activity?.startDate) setSelectedDay(activity.startDate);
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
  }, [data.itinerary, data.trip.slug, suggestions]);
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
  const liveDay = resolvedState?.anchor?.startDate || data.trip.startDate;
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
  const selectedItinerary = useMemo(
    () => itinerary.filter((item) => item.startDate === selectedDay),
    [itinerary, selectedDay],
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
  );
  const pageTitle = getTripPageTitle({
    mode: resolvedState?.mode,
    tripTitle,
    activityTitle: resolvedState?.current?.title,
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

  if (!itinerary.length) {
    return (
      <main className="shell">
        <section className="now-card error-card">
          <h1>Chưa có hoạt động</h1>
          <p>Chuyến đi này chưa có mục lịch trình nào.</p>
          <Link className={trackerStyles["jump-button"]} href="/">
            Chọn chuyến khác
          </Link>
        </section>
        <SavedPlaces places={data.places} activities={data.itinerary} />
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
    status = "Đang xem trước";
    kicker = `Ngày ${tripDays.indexOf(selectedDay) + 1}`;
    title = state.current.title;
    detail = state.current.detail;
    range = `${state.current.start} — ${state.current.endDate !== state.current.startDate ? `${formatDateLabel(state.current.endDate, data.trip.timezone, { weekday: "short", day: "2-digit", month: "2-digit" })} · ` : ""}${state.current.displayEnd || state.current.end}`;
  } else if (state.mode === "before") {
    countdown = formatDuration(state.current.startAt - now);
    status = "Sắp bắt đầu";
    kicker = "Chuyến đi bắt đầu sau";
    title = state.current.title;
    detail = state.current.detail;
    range = `Bắt đầu ${state.current.start}`;
    countdownLabel = "đến giờ đi";
  } else if (state.mode === "after") {
    status = "Đã kết thúc";
    kicker = "Hành trình hoàn tất";
    title = "Chuyến đi đã hoàn tất";
    detail = `Đã đi qua ${itinerary.length} hoạt động trong lịch trình.`;
    range = `Hoàn tất lúc ${state.anchor.end}`;
  } else {
    const item = state.current;
    const target = state.mode === "gap" ? item.startAt : item.endAt;
    countdown = formatDuration(target - now);
    progress =
      state.mode === "active"
        ? (now - item.startAt) / (item.endAt - item.startAt)
        : 0;
    status =
      state.mode === "gap" ? "Đang chờ" : `Đang ${item.type.toLowerCase()}`;
    kicker = state.mode === "gap" ? "Hoạt động tiếp theo" : "Ngay lúc này";
    title = item.title;
    detail = item.detail;
    range = `${item.start} — ${item.endDate !== item.startDate ? `${formatDateLabel(item.endDate, data.trip.timezone, { weekday: "short", day: "2-digit", month: "2-digit" })} · ` : ""}${item.displayEnd || item.end}`;
    countdownLabel = state.mode === "gap" ? "đến hoạt động" : "còn lại";
  }

  const clock = new Intl.DateTimeFormat("vi-VN", {
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
  });
  const scheduleHeading = browsingDay
    ? `Ngày ${tripDays.indexOf(selectedDay) + 1} · ${formatDateLabel(selectedDay, data.trip.timezone, { weekday: "long", day: "2-digit", month: "2-digit" })}`
    : formatScheduleHeading(
        data.trip.startDate,
        data.trip.timezone,
        now,
        data.trip.endDate,
      );
  const isAfter = state.mode === "after";
  const isPreview = state.mode === "preview";
  const showCountdown = !isAfter && !isPreview;
  const jumpLabel = browsingDay
    ? "Về hiện tại"
    : isAfter
      ? "Điểm cuối"
      : "Hiện tại";
  const stationSuggestionActivityId = isAfter ? null : state.current.id;
  const stationSuggestionTarget = isAfter
    ? "cả chuyến đi"
    : state.current.title;
  const stationSuggestionKey = stationSuggestionActivityId || "trip";
  const stationSuggestionLabel = isAfter
    ? "Góp ý cho cả chuyến"
    : "Góp ý cho hoạt động này";

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
        `Chuyến đi đã bắt đầu. Đổi sang “${branch.label}” có thể làm thay đổi hoạt động hiện tại và tiếp theo. Tiếp tục?`,
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
        throw new Error(result.error || "Không đổi được phương án");
      setData(result);
      setBranchAction({ id: null, error: "" });
      setAnnouncement(`Đã dùng phương án ${branch.label} cho cả nhóm.`);
    } catch (error) {
      setBranchAction({
        id: branch.id,
        error: `${error.message}. Hãy thử lại.`,
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
    setSelectedDay(item.startDate);
    requestAnimationFrame(() =>
      document
        .getElementById(item.id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };

  return (
    <main className="shell" data-trip-mode={state.mode}>
      <header className={navigationStyles["trip-bar"]} id="top">
        <a
          className={navigationStyles["product-mark"]}
          href="#top"
          aria-label="Đầu trang"
        >
          <TypeIcon type="Transit" />
          <span>Lịch trình chuyến đi</span>
        </a>
        <div className={navigationStyles["trip-context"]}>
          <label className={navigationStyles["trip-picker"]}>
            <span className="sr-only">Chọn chuyến đi</span>
            <span className={navigationStyles["trip-picker-control"]}>
              <select
                value={data.trip.slug}
                onChange={(event) => {
                  const url = new URL(window.location.href);
                  url.searchParams.set("trip", event.target.value);
                  router.push(`/${url.search}`);
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
                    )}
                  </option>
                ))}
              </select>
              <span
                className={navigationStyles["trip-picker-affordance"]}
                aria-hidden="true"
              >
                <span>Đổi</span>
                <ActionIcon name="down" />
              </span>
            </span>
            <small>
              {tripDateLabel} · {data.trip.location}
            </small>
          </label>
          <AssistantLauncher tripSlug={data.trip.slug} />
          <button
            className={`${navigationStyles["admin-link"]} ${navigationStyles["invite-link"]}`}
            type="button"
            onClick={() => setInvitationOpen(true)}
          >
            <ActionIcon name="invite" />
            <span>Rủ bạn đi cùng</span>
          </button>
        </div>
        <div className={navigationStyles["viewer-utilities"]}>
          {viewer?.isAdmin && (
            <Link
              className={`${navigationStyles["admin-link"]} ${trackerStyles["desktop-manage-link"]}`}
              href={ADMIN_ROUTES.trips}
            >
              Quản lý
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
              Đăng nhập
            </button>
          )}
        </div>
        <div
          className={trackerStyles["live-clock"]}
          aria-label={`Giờ hiện tại tại ${data.trip.timezone}`}
        >
          <span className={trackerStyles["live-dot"]} aria-hidden="true" />
          <small>
            {data.trip.timezone === "Asia/Tokyo" ? "JST" : data.trip.timezone}
          </small>
          <span>{clock}</span>
        </div>
      </header>

      <nav
        className={trackerStyles["trip-day-selector"]}
        aria-label="Chọn ngày trong chuyến đi"
        ref={daySelectorRef}
      >
        {tripDays.map((date, index) => {
          const count = itinerary.filter(
            (item) => item.startDate === date,
          ).length;
          return (
            <button
              key={date}
              type="button"
              data-trip-day={date}
              aria-current={selectedDay === date ? "date" : undefined}
              onClick={() => setSelectedDay(date)}
            >
              <span>Ngày {index + 1}</span>
              <strong>
                {formatDateLabel(date, data.trip.timezone, {
                  weekday: "short",
                  day: "2-digit",
                  month: "2-digit",
                })}
              </strong>
              <small>{count ? `${count} hoạt động` : "Chưa có lịch"}</small>
            </button>
          );
        })}
      </nav>

      {!selectedItinerary.length && (
        <section className={trackerStyles["empty-trip-day"]} aria-live="polite">
          <span className={trackerStyles["route-node"]} aria-hidden="true" />
          <div>
            <h1>Ngày này chưa có hoạt động</h1>
            <p>
              Lịch trình vẫn giữ ngày này trong chuyến đi. Chọn một ngày khác để
              xem tuyến đã lên kế hoạch.
            </p>
          </div>
          {browsingDay && (
            <button
              type="button"
              className={trackerStyles["jump-button"]}
              onClick={jumpToCurrent}
            >
              Về ngày hiện tại
            </button>
          )}
        </section>
      )}

      {selectedItinerary.length > 0 && (
        <section
          className={trackerStyles["live-board"]}
          aria-label={
            browsingDay
              ? "Xem trước ngày đã chọn"
              : "Tình trạng chuyến đi hiện tại"
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
                            ? `${item.type} · ${item.branchLabel}`
                            : item.type}
                          {branchGroup
                            ? ` · ${branchGroup.branches.length} phương án`
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
              {detail && <ActivityDetail detail={detail} placement="station" />}
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
                  {viewer ? stationSuggestionLabel : "Đăng nhập để góp ý"}
                </button>
                <span>
                  {
                    (suggestionsByActivity.get(stationSuggestionKey) || [])
                      .length
                  }{" "}
                  ghi chú
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
                <span>Tiếp theo</span>
                <TypeIcon type={stationNext.type} />
                <strong>{stationNext.title}</strong>
                <small>
                  {stationNext.startDate !== selectedDay
                    ? `${formatDateLabel(stationNext.startDate, data.trip.timezone, { weekday: "short", day: "2-digit", month: "2-digit" })} · `
                    : ""}
                  {stationNext.start} ·{" "}
                  {stationNext.branchLabel || stationNext.type}
                </small>
                <ActionIcon name="right" />
              </a>
            )}

            <div className={trackerStyles["station-legend"]}>
              <span>
                <i className={`${trackerStyles["legend-line"]} active`} /> Đang
                đi
              </span>
              <span>
                <i className={`${trackerStyles["legend-line"]} next`} /> Tiếp
                theo
              </span>
              <span>
                <i className={`${trackerStyles["legend-line"]} done`} /> Đã qua
              </span>
            </div>
          </div>
        </section>
      )}

      {selectedItinerary.length > 0 && (
        <section
          className={trackerStyles["mobile-route-board"]}
          aria-label="Tuyến lịch trình hiện tại"
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
                          ? `${item.type} · ${item.branchLabel}`
                          : item.type}
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
                      {detail && (
                        <ActivityDetail detail={detail} placement="mobile" />
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
                            : "Đăng nhập để góp ý"}
                        </button>
                        <span>
                          {
                            (
                              suggestionsByActivity.get(stationSuggestionKey) ||
                              []
                            ).length
                          }{" "}
                          ghi chú
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
                            Tiếp theo ·{" "}
                            {stationNext.startDate !== selectedDay
                              ? `${formatDateLabel(stationNext.startDate, data.trip.timezone, { weekday: "short", day: "2-digit", month: "2-digit" })} · `
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
            <small>{browsingDay ? "Về ngày hiện tại" : status}</small>
            <strong>{resolvedState.anchor.title}</strong>
          </span>
          {resolvedState.next && (
            <span>
              <small>Tiếp theo · {resolvedState.next.start}</small>
              <strong>{resolvedState.next.title}</strong>
            </span>
          )}
          <ActionIcon name="right" />
        </button>
      )}

      <div className={trackerStyles["section-heading"]}>
        <h2>Toàn bộ lịch trình</h2>
        <button
          className={trackerStyles["jump-button"]}
          type="button"
          onClick={jumpToCurrent}
        >
          {isAfter ? "Về điểm cuối" : "Về hiện tại"} <ActionIcon name="down" />
        </button>
      </div>

      {selectedItinerary.length > 0 && (
        <section
          className={trackerStyles["timeline"]}
          aria-label={`Lịch trình chi tiết ${selectedDay}`}
        >
          {selectedDay === data.trip.startDate && startBranchGroup && (
            <div className={trackerStyles["trip-start-junction"]}>
              <BranchJunction
                group={startBranchGroup}
                startsTrip
                viewer={viewer}
                sourceMap={sourceMap}
                suggestionsByActivity={suggestionsByActivity}
                suggestionListProps={suggestionListProps}
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
                        {item.type}
                        {item.branchLabel ? ` · ${item.branchLabel}` : ""}
                      </span>
                      <span className={trackerStyles["done-label"]}>
                        Đã qua
                      </span>
                    </div>
                    <h3>{item.title}</h3>
                    {item.detail && (
                      <ActivityDetail
                        detail={item.detail}
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
                    <button
                      className={contributionsStyles["suggestion-trigger"]}
                      type="button"
                      onClick={() => openSuggestion(item.id, item.title)}
                    >
                      {viewer
                        ? "Góp ý cho hoạt động này"
                        : "Đăng nhập để góp ý"}
                    </button>
                  </div>
                </article>
                {branchGroup && (
                  <BranchJunction
                    group={branchGroup}
                    viewer={viewer}
                    sourceMap={sourceMap}
                    suggestionsByActivity={suggestionsByActivity}
                    suggestionListProps={suggestionListProps}
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

      <section
        className={contributionsStyles["trip-suggestions"]}
        aria-labelledby="trip-suggestions-title"
      >
        <h2 id="trip-suggestions-title">Ghi chú cho cả chuyến</h2>
        <button
          className={trackerStyles["jump-button"]}
          type="button"
          onClick={() => openSuggestion(null, "cả chuyến đi")}
        >
          Thêm ghi chú
        </button>
        <SuggestionList
          suggestions={suggestionsByActivity.get("trip") || []}
          {...suggestionListProps}
        />
      </section>

      <section
        className={contributionsStyles["sources"]}
        aria-labelledby="sources-title"
      >
        <div className={`${trackerStyles["section-heading"]} compact`}>
          <h2 id="sources-title">Nguồn địa điểm</h2>
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

      <SavedPlaces places={data.places} activities={data.itinerary} />
      <Footer>
        <span>{tripTitle}</span>
        <span>Giữ nhịp chậm, chụp thật đẹp.</span>
      </Footer>

      {contributionDialogs}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {invitationOpen && (
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
      )}
    </main>
  );
}

function BranchJunction({
  group,
  startsTrip = false,
  viewer,
  sourceMap,
  suggestionsByActivity,
  suggestionListProps,
  branchAction,
  onSelect,
  onSuggest,
}) {
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
            {startsTrip ? "Điểm rẽ đầu chuyến" : "Điểm rẽ"} ·{" "}
            {group.branches.length} phương án
          </small>
          <strong id={`public-branch-${group.id}`}>{group.title}</strong>
          <em>Đang dùng: {selected.label}</em>
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
                      {isSelected ? "Đang dùng" : "Dự phòng"}
                      {branch.isDefault ? " · Mặc định" : ""}
                    </span>
                    <strong>{branch.label}</strong>
                    <small>{branch.condition}</small>
                  </button>
                  {viewer?.isAdmin && !isSelected && (
                    <button
                      className={trackerStyles["branch-select-button"]}
                      type="button"
                      disabled={branchAction.id === branch.id}
                      onClick={() => onSelect(group, branch)}
                    >
                      {branchAction.id === branch.id
                        ? "Đang đổi…"
                        : "Dùng phương án này"}
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
                    Các hoạt động của phương án này đang nằm trên tuyến chính
                    phía dưới.
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
                            {item.type}
                          </span>
                          <h4>{item.title}</h4>
                          {item.detail && (
                            <ActivityDetail
                              detail={item.detail}
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
                          <button
                            className={
                              contributionsStyles["suggestion-trigger"]
                            }
                            type="button"
                            onClick={() => onSuggest(item.id, item.title)}
                          >
                            {viewer
                              ? "Góp ý cho hoạt động này"
                              : "Đăng nhập để góp ý"}
                          </button>
                        </div>
                      </article>
                    ))}
                    {!branch.itinerary.length && (
                      <p className={trackerStyles["branch-empty"]}>
                        Không có hoạt động — đi thẳng tới mốc hội nhập.
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

function ActivityDetail({ detail, placement }) {
  const contacts = parseContactDirectory(detail);
  if (!contacts) {
    const className =
      placement === "station"
        ? trackerStyles["now-detail"]
        : placement === "mobile"
          ? trackerStyles["mobile-foldout-detail"]
          : undefined;
    return <p className={className}>{detail}</p>;
  }
  return <ContactDirectory contacts={contacts} placement={placement} />;
}

function ContactDirectory({ contacts, placement }) {
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
      aria-label="Số điện thoại đặt bàn"
    >
      {contacts.map((contact) => {
        const state =
          copyState.phone === contact.phone ? copyState.status : "idle";
        const buttonLabel =
          state === "copied"
            ? "Đã sao chép"
            : state === "error"
              ? "Không sao chép được, thử lại"
              : "Sao chép";
        return (
          <div
            className={trackerStyles["contact-directory-row"]}
            key={`${contact.name}-${contact.phone}`}
          >
            <span className={trackerStyles["contact-directory-name"]}>
              {contact.name}
            </span>
            <a
              className={trackerStyles["contact-directory-phone"]}
              href={`tel:${contact.dial}`}
              aria-label={`Gọi ${contact.name} theo số ${contact.phone}`}
            >
              {contact.phone}
            </a>
            <button
              className={
                state === "copied"
                  ? "is-copied"
                  : state === "error"
                    ? "is-error"
                    : ""
              }
              type="button"
              aria-label={`${buttonLabel} số điện thoại ${contact.name}`}
              title={`${buttonLabel} số điện thoại`}
              onClick={() => copyPhone(contact)}
            >
              <ActionIcon name={state === "copied" ? "check" : "copy"} />
            </button>
          </div>
        );
      })}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {copyState.status === "copied"
          ? `Đã sao chép ${copyState.phone}.`
          : copyState.status === "error"
            ? `Không sao chép được ${copyState.phone}. Chạm lại để thử.`
            : ""}
      </span>
    </div>
  );
}

function Citation({ source }) {
  if (!source) return null;
  return (
    <a
      className={trackerStyles["citation"]}
      href={source.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Mở nguồn ${source.number}`}
    >
      Nguồn {source.number}
      <ActionIcon name="external" />
    </a>
  );
}
