"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { ADMIN_ROUTES } from "../lib/admin-routes.mjs";
import { formatScheduleHeading, formatTripTitle } from "../lib/trip-date-label.mjs";
import { getTripPageTitle } from "../lib/trip-page-title.mjs";
import { getTripTrackerState } from "../lib/trip-tracker-state.mjs";
import { ActionIcon, TypeIcon } from "./Icons";
import ConfirmDialog from "./ConfirmDialog";
import InvitationDialog from "./InvitationDialog";
import NotificationCenter from "./NotificationCenter";
import ViewerMenu from "./ViewerMenu";

const JST_OFFSET = "+09:00";
const NOTIFICATION_NAVIGATION_EVENT = "travel-plan:notification-navigation";

const toDate = (date, time) => new Date(`${date}T${time}:00${JST_OFFSET}`);

const formatDuration = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return { value: `${hours}h ${String(minutes).padStart(2, "0")}`, unit: "giờ · phút" };
  return { value: `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`, unit: "phút · giây" };
};

export default function TripTracker({ initialData, initialNow, initialInvitationOpen = false, initialGmailReturn = false, viewer, trips }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [now, setNow] = useState(() => new Date(initialNow));
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionTarget, setSuggestionTarget] = useState(null);
  const [suggestionError, setSuggestionError] = useState("");
  const [suggestionAction, setSuggestionAction] = useState({ id: null, error: "" });
  const [deletionCandidate, setDeletionCandidate] = useState(null);
  const [deletionError, setDeletionError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [invitationOpen, setInvitationOpen] = useState(initialInvitationOpen);
  const [gmailReturn, setGmailReturn] = useState(initialGmailReturn);
  const routeListRef = useRef(null);
  const activeStopRef = useRef(null);
  const stationStageRef = useRef(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    fetch(`/api/itinerary?slug=${encodeURIComponent(initialData.trip.slug)}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("API request failed")))
      .then(setData)
      .catch(() => {});
    fetch(`/api/trips/${encodeURIComponent(initialData.trip.slug)}/suggestions`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Suggestion request failed")))
      .then((result) => setSuggestions(result.suggestions))
      .catch(() => {});
    return () => window.clearInterval(timer);
  }, [initialData.trip.slug]);

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
      const url = new URL(event?.detail?.targetUrl || window.location.href, window.location.origin);
      const targetTrip = url.searchParams.get("trip");
      if (targetTrip && targetTrip !== data.trip.slug) return;
      const match = url.hash.match(/^#contribution-(\d+)$/);
      if (!match) return;
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
        timer = window.setTimeout(() => target.classList.remove("is-notification-target"), 2_800);
      };
      frame = window.requestAnimationFrame(focusTarget);
    };
    revealContribution();
    window.addEventListener("hashchange", revealContribution);
    window.addEventListener(NOTIFICATION_NAVIGATION_EVENT, revealContribution);
    return () => {
      window.removeEventListener("hashchange", revealContribution);
      window.removeEventListener(NOTIFICATION_NAVIGATION_EVENT, revealContribution);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [data.trip.slug, suggestions]);

  const itinerary = useMemo(() => data.itinerary.map((item) => ({
    ...item,
    startAt: toDate(data.trip.date, item.start),
    endAt: toDate(data.trip.date, item.end),
  })), [data]);
  const sourceMap = useMemo(() => new Map(data.sources.map((source) => [source.number, source])), [data.sources]);
  const suggestionsByActivity = useMemo(() => {
    const grouped = new Map();
    for (const suggestion of suggestions) {
      const key = suggestion.activityId || "trip";
      grouped.set(key, [...(grouped.get(key) || []), suggestion]);
    }
    return grouped;
  }, [suggestions]);
  const resolvedState = itinerary.length ? getTripTrackerState(now, itinerary) : null;
  const tripTitle = formatTripTitle(data.trip.title, data.trip.date, data.trip.timezone, now);
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
    headObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
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
      const connectionY = Math.max(28, Math.min(stageRect.height - 28, activeCenter - stageRect.top));
      const notchY = Math.max(28, Math.min(stationRect.height - 28, activeCenter - stationRect.top));
      const isVisible = activeCenter >= listRect.top && activeCenter <= listRect.bottom;

      stage.style.setProperty("--route-connection-y", `${connectionY}px`);
      stage.style.setProperty("--route-connection-opacity", isVisible ? "1" : "0");
      station.style.setProperty("--station-notch-y", `${notchY}px`);
      station.style.setProperty("--station-notch-depth", isVisible ? "18px" : "0px");
    };

    const align = () => {
      if (mobileQuery.matches) return;
      const activeRect = active.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      list.scrollTop += (activeRect.top + activeRect.height / 2) - (stageRect.top + stageRect.height / 2);
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
  }, [resolvedState?.anchor?.id, itinerary.length]);

  if (!itinerary.length) {
    return (
      <main className="shell">
        <section className="now-card error-card">
          <h1>Chưa có hoạt động</h1>
          <p>Chuyến đi này chưa có mục lịch trình nào.</p>
          <Link className="jump-button" href="/">Chọn chuyến khác</Link>
        </section>
      </main>
    );
  }
  const state = resolvedState;

  let countdown;
  let progress = 0;
  let status;
  let kicker;
  let title;
  let detail;
  let range;
  let countdownLabel;

  if (state.mode === "before") {
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
    progress = state.mode === "active" ? (now - item.startAt) / (item.endAt - item.startAt) : 0;
    status = state.mode === "gap" ? "Đang chờ" : `Đang ${item.type.toLowerCase()}`;
    kicker = state.mode === "gap" ? "Hoạt động tiếp theo" : "Ngay lúc này";
    title = item.title;
    detail = item.detail;
    range = `${item.start} — ${item.displayEnd || item.end}`;
    countdownLabel = state.mode === "gap" ? "đến hoạt động" : "còn lại";
  }

  const clock = new Intl.DateTimeFormat("vi-VN", {
    timeZone: data.trip.timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  const tripDateLabel = new Intl.DateTimeFormat("vi-VN", {
    timeZone: data.trip.timezone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(toDate(data.trip.date, "00:00"));
  const scheduleHeading = formatScheduleHeading(data.trip.date, data.trip.timezone, now);
  const isAfter = state.mode === "after";
  const jumpLabel = isAfter ? "Điểm cuối" : "Hiện tại";
  const stationSuggestionActivityId = isAfter ? null : state.current.id;
  const stationSuggestionTarget = isAfter ? "cả chuyến đi" : state.current.title;
  const stationSuggestionKey = stationSuggestionActivityId || "trip";
  const stationSuggestionLabel = isAfter ? "Góp ý cho cả chuyến" : "Góp ý tại ga này";

  const jumpToCurrent = () => {
    const target = isAfter ? state.anchor.id : (state.mode === "active" ? state.current.id : (state.next?.id || itinerary.at(-1).id));
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const openSuggestion = (activityId, targetTitle) => {
    if (!viewer) {
      signIn("google", { redirectTo: "/" });
      return;
    }
    setSuggestionError("");
    setSuggestionTarget({ activityId, targetTitle });
  };

  const submitSuggestion = async ({ kind, body }) => {
    const response = await fetch(`/api/trips/${encodeURIComponent(data.trip.slug)}/suggestions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activityId: suggestionTarget.activityId, kind, body }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Không gửi được góp ý");
    setSuggestions((current) => [result, ...current]);
    setSuggestionTarget(null);
  };

  const updateContributionStatus = async (suggestion) => {
    const status = suggestion.status === "resolved" ? "open" : "resolved";
    setSuggestionAction({ id: suggestion.id, error: "" });
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(data.trip.slug)}/suggestions/${suggestion.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Không cập nhật được góp ý");
      setSuggestions((current) => current.map((item) => item.id === suggestion.id ? result : item));
      setSuggestionAction({ id: null, error: "" });
      setAnnouncement(result.status === "resolved" ? "Đã đánh dấu bình luận là đã xử lý." : "Đã mở lại bình luận.");
      return true;
    } catch (error) {
      setSuggestionAction({ id: suggestion.id, error: error.message });
      return false;
    }
  };

  const updateContributionVisibility = async (suggestion) => {
    const hidden = !suggestion.hidden;
    setSuggestionAction({ id: suggestion.id, error: "" });
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(data.trip.slug)}/suggestions/${suggestion.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hidden }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Không đổi được hiển thị góp ý");
      setSuggestions((current) => current.map((item) => item.id === suggestion.id ? result : item));
      setSuggestionAction({ id: null, error: "" });
      setAnnouncement(hidden ? "Đã ẩn nội dung khỏi lịch công khai." : "Đã hiện lại nội dung trên lịch.");
      return true;
    } catch (error) {
      setSuggestionAction({ id: suggestion.id, error: error.message });
      return false;
    }
  };

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
      const response = await fetch(`/api/trips/${encodeURIComponent(data.trip.slug)}/suggestions/${suggestion.id}`, { method: "DELETE" });
      const result = response.status === 204 ? null : await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "Không xoá được góp ý");
      setSuggestions((current) => current.filter((item) => item.id !== suggestion.id));
      setSuggestionAction({ id: null, error: "" });
      setDeletionCandidate(null);
      setAnnouncement("Đã xoá vĩnh viễn nội dung.");
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

  return (
    <main className="shell" data-trip-mode={state.mode}>
      <header className="trip-bar" id="top">
        <a className="product-mark" href="#top" aria-label="Đầu trang">
          <TypeIcon type="Transit" />
          <span>Lịch trình chuyến đi</span>
        </a>
        <div className="trip-context">
          <label className="trip-picker">
            <span className="sr-only">Chọn chuyến đi</span>
            <span className="trip-picker-control">
              <select value={data.trip.slug} onChange={(event) => router.push(`/?trip=${encodeURIComponent(event.target.value)}`)}>
                {trips.map((trip) => (
                  <option value={trip.slug} key={trip.slug}>{formatTripTitle(trip.title, trip.date, trip.timezone, now)}</option>
                ))}
              </select>
              <span className="trip-picker-affordance" aria-hidden="true">
                <span>Đổi</span>
                <ActionIcon name="down" />
              </span>
            </span>
            <small>{tripDateLabel} · {data.trip.location}</small>
          </label>
          <button className="admin-link invite-link" type="button" onClick={() => setInvitationOpen(true)}>
            <ActionIcon name="invite" />
            <span>Rủ bạn đi cùng</span>
          </button>
        </div>
        <div className="viewer-utilities">
          {viewer?.isAdmin && <Link className="admin-link desktop-manage-link" href={ADMIN_ROUTES.trips}>Quản lý</Link>}
          {viewer && !viewer.isOwner && <NotificationCenter />}
          {viewer ? <ViewerMenu viewer={viewer} /> : (
            <button className="admin-link user-link" type="button" onClick={() => signIn("google", { redirectTo: "/" })}>Đăng nhập</button>
          )}
        </div>
        <div className="live-clock" aria-label="Giờ hiện tại tại Nhật Bản">
          <span className="live-dot" aria-hidden="true" />
          <small>JST</small><span>{clock}</span>
        </div>
      </header>

      <section className="live-board" aria-label="Tình trạng chuyến đi hiện tại">
        <aside className="route-overview">
          <div className="route-overview-head">
            <h2>{scheduleHeading}</h2>
            <button type="button" onClick={jumpToCurrent}>{jumpLabel}</button>
          </div>
          <ol className="route-stops" ref={routeListRef}>
            {itinerary.map((item, index) => {
              const isFocused = item.id === state.anchor.id;
              const isDone = index < state.index || state.mode === "after";
              const isTerminus = isAfter && isFocused;
              return (
                <li className={`${isFocused && !isAfter ? "is-active" : ""}${isDone ? " is-done" : ""}${isTerminus ? " is-terminus" : ""}`} ref={isFocused ? activeStopRef : null} key={item.id}>
                  <a href={`#${item.id}`}>
                    <time>{item.start}</time>
                    <span className="route-node" aria-hidden="true" />
                    <span className="route-stop-copy"><strong>{item.title}</strong><small>{item.type}</small></span>
                  </a>
                </li>
              );
            })}
          </ol>
        </aside>

        <div className="station-stage" ref={stationStageRef}>
          <p className="sr-only" role="status" aria-live="polite">{status}: {title}. {range}</p>
          <section className="now-station" data-mode={state.mode}>
            <div className="station-status"><span>{kicker}</span><strong>{status}</strong></div>
            <div className="station-main">
              <div className="station-copy">
                <span className="station-icon" aria-hidden="true">{isAfter ? <ActionIcon name="check" /> : <TypeIcon type={state.current.type} />}</span>
                <div><h1>{title}</h1><p className="station-range">{range}</p></div>
              </div>
              {!isAfter && <div className="countdown-wrap">
                <span>{countdownLabel}</span>
                <strong>{countdown.value}</strong>
                <small>{countdown.unit}</small>
                <i className="countdown-progress" style={{ "--progress": Math.min(1, progress) }} aria-hidden="true" />
              </div>}
            </div>
            <p className="now-detail">{detail}</p>
            {!isAfter && state.current.refs.length > 0 && (
              <div className="citations">{state.current.refs.map((ref) => <Citation key={ref} source={sourceMap.get(ref)} />)}</div>
            )}
            <div className="station-actions">
              <button type="button" onClick={() => openSuggestion(stationSuggestionActivityId, stationSuggestionTarget)}>
                {viewer ? stationSuggestionLabel : "Đăng nhập để góp ý"}
              </button>
              <span>{(suggestionsByActivity.get(stationSuggestionKey) || []).length} ghi chú</span>
            </div>
            <SuggestionList suggestions={suggestionsByActivity.get(stationSuggestionKey) || []} anchorItems={false} {...suggestionListProps} />
          </section>

          {state.next && (
            <a className="next-station" href={`#${state.next.id}`}>
              <span>Tiếp theo</span>
              <TypeIcon type={state.next.type} />
              <strong>{state.next.title}</strong>
              <small>{state.next.start} · {state.next.type}</small>
              <ActionIcon name="right" />
            </a>
          )}

          <div className="station-legend">
            <span><i className="legend-line active" /> Đang đi</span>
            <span><i className="legend-line next" /> Tiếp theo</span>
            <span><i className="legend-line done" /> Đã qua</span>
          </div>
        </div>
      </section>

      <section className="mobile-route-board" aria-label="Tuyến lịch trình hiện tại">
        <div className="mobile-route-head"><h2>{scheduleHeading}</h2><button type="button" onClick={jumpToCurrent}>{jumpLabel}</button></div>
        <ol>
          {itinerary.map((item, index) => {
            const isFocused = item.id === state.anchor.id;
            const isDone = index < state.index || state.mode === "after";
            const isTerminus = isAfter && isFocused;
            return (
              <li className={`mobile-route-stop${isFocused && !isAfter ? " is-active" : ""}${isDone ? " is-done" : ""}${isTerminus ? " is-terminus" : ""}`} key={item.id}>
                <a className="mobile-stop-label" href={`#${item.id}`}>
                  <time>{item.start}</time><i aria-hidden="true" />
                  <span><strong>{item.title}</strong><small>{item.type}</small></span>
                </a>
                {isFocused && (
                  <section className="mobile-active-foldout">
                    <div className="mobile-foldout-status"><span>{kicker}</span><strong>{status}</strong></div>
                    <div className="mobile-foldout-title">{isAfter ? <ActionIcon name="check" /> : <TypeIcon type={item.type} />}<h1>{title}</h1></div>
                    <p className="mobile-foldout-range">{range}</p>
                    {!isAfter && <div className="mobile-foldout-countdown"><span>{countdownLabel}</span><strong>{countdown.value}</strong><small>{countdown.unit}</small></div>}
                    <p className="mobile-foldout-detail">{detail}</p>
                    {!isAfter && item.refs.length > 0 && <div className="citations">{item.refs.map((ref) => <Citation key={ref} source={sourceMap.get(ref)} />)}</div>}
                    <div className="station-actions">
                      <button type="button" onClick={() => openSuggestion(stationSuggestionActivityId, stationSuggestionTarget)}>{viewer ? stationSuggestionLabel : "Đăng nhập để góp ý"}</button>
                      <span>{(suggestionsByActivity.get(stationSuggestionKey) || []).length} ghi chú</span>
                    </div>
                    {state.next && (
                      <a className="mobile-next-fascia" href={`#${state.next.id}`}>
                        <span>Tiếp theo · {state.next.start}</span><strong>{state.next.title}</strong><ActionIcon name="right" />
                      </a>
                    )}
                  </section>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {!isAfter && <button className="mobile-live-dock" type="button" onClick={jumpToCurrent}>
        <span><small>{status}</small><strong>{state.current.title}</strong></span>
        {state.next && <span><small>Tiếp theo · {state.next.start}</small><strong>{state.next.title}</strong></span>}
        <ActionIcon name="right" />
      </button>}

      <div className="section-heading">
        <h2>Toàn bộ lịch trình</h2>
        <button className="jump-button" type="button" onClick={jumpToCurrent}>{isAfter ? "Về điểm cuối" : "Về hiện tại"} <ActionIcon name="down" /></button>
      </div>

      <section className="timeline" aria-label="Lịch trình chi tiết">
        {itinerary.map((item, index) => {
          const isCurrent = state.mode === "active" && index === state.index;
          const isDone = index < state.index || state.mode === "after";
          return (
            <article className={`timeline-item${isCurrent ? " is-current" : ""}${isDone ? " is-done" : ""}`} id={item.id} key={item.id}>
              <div className="timeline-time"><strong>{item.start}</strong><span>{item.displayEnd || item.end}</span></div>
              <div className="timeline-rail"><span className="timeline-dot" aria-hidden="true" /></div>
              <div className="timeline-card">
                <div className="timeline-card-head">
                  <span className="type-label"><TypeIcon type={item.type} />{item.type}</span>
                  <span className="done-label">Đã qua</span>
                </div>
                <h3>{item.title}</h3><p>{item.detail}</p>
                {item.refs.length > 0 && <div className="citations">{item.refs.map((ref) => <Citation key={ref} source={sourceMap.get(ref)} />)}</div>}
                <SuggestionList suggestions={suggestionsByActivity.get(item.id) || []} {...suggestionListProps} />
                <button className="suggestion-trigger" type="button" onClick={() => openSuggestion(item.id, item.title)}>
                  {viewer ? "Góp ý cho mục này" : "Đăng nhập để góp ý"}
                </button>
              </div>
            </article>
          );
        })}
      </section>

      <section className="trip-suggestions" aria-labelledby="trip-suggestions-title">
        <h2 id="trip-suggestions-title">Ghi chú cho cả chuyến</h2>
        <button className="jump-button" type="button" onClick={() => openSuggestion(null, "cả chuyến đi")}>Thêm ghi chú</button>
        <SuggestionList suggestions={suggestionsByActivity.get("trip") || []} {...suggestionListProps} />
      </section>

      <section className="sources" aria-labelledby="sources-title">
        <div className="section-heading compact"><h2 id="sources-title">Nguồn địa điểm</h2></div>
        <div className="source-list">
          {data.sources.map((source) => (
            <a className="source-card" href={source.url} target="_blank" rel="noreferrer" key={source.number}>
              <span className="source-number">{String(source.number).padStart(2, "0")}</span>
              <span><strong>{source.title}</strong><small>{source.host}</small></span>
              <span className="source-arrow"><ActionIcon name="external" /></span>
            </a>
          ))}
        </div>
      </section>

      <footer><span>{tripTitle}</span><span>Giữ nhịp chậm, chụp thật đẹp.</span></footer>

      {suggestionTarget && (
        <SuggestionComposer target={suggestionTarget.targetTitle} error={suggestionError} onClose={() => setSuggestionTarget(null)} onSubmit={async (values) => {
          try { await submitSuggestion(values); }
          catch (error) { setSuggestionError(error.message); }
        }} />
      )}
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
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
      {invitationOpen && <InvitationDialog open onClose={() => { setInvitationOpen(false); setGmailReturn(false); }} viewer={viewer} trip={data.trip} itinerary={data.itinerary} gmailReturn={gmailReturn} />}
    </main>
  );
}

function SuggestionList({ suggestions, action, onDelete, onToggleResolved, onToggleVisibility, anchorItems = true }) {
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

function Citation({ source }) {
  if (!source) return null;
  return (
    <a className="citation" href={source.url} target="_blank" rel="noreferrer" aria-label={`Mở nguồn ${source.number}`}>
      Nguồn {source.number}<ActionIcon name="external" />
    </a>
  );
}
