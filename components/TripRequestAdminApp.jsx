"use client";
import adminShellStyles from "../src/styles/admin-shell.module.css";
import tripRequestsStyles from "../src/styles/trip-requests.module.css";
import scheduleEditorStyles from "../src/styles/schedule-editor.module.css";

import Footer from "./ui/Footer";
import Button from "./ui/Button";

import { requestJson } from "../lib/request-json.mjs";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import AdminNav from "./AdminNav";
import LanguageSwitcher from "./LanguageSwitcher";
import { useLocale } from "./LocaleProvider";
import { adminErrorMessage } from "../lib/i18n-admin.mjs";
import TripRequestDetails, {
  formatRequestRange,
  formatRequestDate,
} from "./TripRequestDetails";

export default function TripRequestAdminApp({
  viewer,
  initialRequests,
  trips,
  pendingInvitationCount = 0,
}) {
  const api = (path, options) =>
    requestJson(path, options, t("adminExtra.message134"));
  const router = useRouter();
  const { t, intlLocale, locale } = useLocale();
  const requestStateLabels = {
    open: t("adminExtra.message140"),
    fulfilled: t("adminExtra.message141"),
    declined: t("adminExtra.message142"),
    withdrawn: t("adminExtra.message143"),
  };
  const [requests, setRequests] = useState(initialRequests);
  const [selectedId, setSelectedId] = useState(
    initialRequests.find((request) => request.state === "open")?.id ||
      initialRequests[0]?.id ||
      null,
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("open");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [declineReason, setDeclineReason] = useState(null);
  const [creatingTrip, setCreatingTrip] = useState(false);
  const [tripDraft, setTripDraft] = useState(null);
  const [attachSlug, setAttachSlug] = useState(trips[0]?.slug || "");

  const openCount = requests.filter(
    (request) => request.state === "open",
  ).length;
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      requests.filter(
        (request) =>
          (filter === "all" || request.state === filter) &&
          (!needle ||
            request.requester.name.toLowerCase().includes(needle) ||
            request.requester.email.toLowerCase().includes(needle) ||
            request.places.some((place) =>
              place.toLowerCase().includes(needle),
            )),
      ),
    [filter, needle, requests],
  );
  const selected =
    requests.find((request) => request.id === selectedId) ||
    visible[0] ||
    requests[0] ||
    null;

  const replaceRequest = (updated) => {
    setRequests((current) =>
      current.map((request) => (request.id === updated.id ? updated : request)),
    );
    setSelectedId(updated.id);
  };
  const run = async (action, success) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (result?.id) replaceRequest(result);
      setNotice(success);
      return result;
    } catch (actionError) {
      setError(
        t("adminExtra.message025", {
          value0: adminErrorMessage(actionError, t, locale),
        }),
      );
      return null;
    } finally {
      setBusy(false);
    }
  };
  const selectRequest = (request) => {
    if (creatingTrip && !window.confirm(t("adminExtra.message135"))) return;
    setSelectedId(request.id);
    setCreatingTrip(false);
    setTripDraft(null);
    setDeclineReason(null);
    setError("");
  };
  const startTrip = () => {
    setCreatingTrip(true);
    setDeclineReason(null);
    setTripDraft({
      slug: "",
      title: "",
      startDate: selected.startDate,
      endDate: selected.endDate,
      timezone: "Asia/Tokyo",
      location: selected.places.join(", "),
    });
  };
  const createTrip = async (event) => {
    event.preventDefault();
    const created = await run(
      () =>
        api(`/api/admin/trip-requests/${selected.id}/trip`, {
          method: "POST",
          body: JSON.stringify(tripDraft),
        }),
      t("adminExtra.message136"),
    );
    if (created?.slug)
      router.push(`/admin/trips?trip=${encodeURIComponent(created.slug)}`);
  };

  return (
    <main
      className={`${adminShellStyles["admin-shell"]} ${tripRequestsStyles["request-admin-shell"]}`}
    >
      <header className={adminShellStyles["admin-header"]}>
        <div>
          <Link href="/" className={adminShellStyles["admin-back"]}>
            {t("common.backToSchedule")}
          </Link>
          <h1>{t("requests.title")}</h1>
          <small className={adminShellStyles["admin-user"]}>
            {viewer.email}
          </small>
        </div>
        <LanguageSwitcher />
        {viewer.authMode !== "local-dev" && (
          <Button
            variant="ghost"
            type="button"
            onClick={() => signOut({ redirectTo: "/" })}
          >
            {t("common.logout")}
          </Button>
        )}
      </header>
      <AdminNav
        active="requests"
        pendingInvitationCount={pendingInvitationCount}
        pendingTripRequestCount={openCount}
      />
      {error && (
        <p className={adminShellStyles["admin-alert"]} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={adminShellStyles["admin-notice"]} role="status">
          {notice}
        </p>
      )}

      <section className={tripRequestsStyles["request-admin-board"]}>
        <div className={tripRequestsStyles["request-admin-controls"]}>
          <label>
            {t("adminExtra.message137")}{" "}
            <input
              type="search"
              value={query}
              placeholder={t("adminExtra.message138")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            {t("adminExtra.message139")}{" "}
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="open">{t("adminExtra.message140")}</option>
              <option value="fulfilled">{t("adminExtra.message141")}</option>
              <option value="declined">{t("adminExtra.message142")}</option>
              <option value="withdrawn">{t("adminExtra.message143")}</option>
              <option value="all">{t("adminExtra.message144")}</option>
            </select>
          </label>
          <p>
            <strong>{openCount}</strong> {t("adminExtra.message145")}{" "}
            {visible.length}/{requests.length}
          </p>
        </div>

        <div className={tripRequestsStyles["request-admin-workspace"]}>
          <aside
            className={tripRequestsStyles["request-admin-queue"]}
            aria-label={t("adminExtra.message146")}
          >
            {visible.map((request) => (
              <button
                className={`${tripRequestsStyles["request-admin-row"]} is-${request.state}${selected?.id === request.id ? " is-active" : ""}`}
                type="button"
                onClick={() => selectRequest(request)}
                key={request.id}
              >
                <span
                  className={tripRequestsStyles["request-rail-node"]}
                  aria-hidden="true"
                />
                <b>{request.places.join(" · ")}</b>
                <small>
                  {request.requester.name} ·{" "}
                  {formatRequestRange(request, intlLocale)}
                </small>
                <em>{requestStateLabels[request.state]}</em>
              </button>
            ))}
            {!visible.length && (
              <p className={tripRequestsStyles["request-admin-empty"]}>
                {t("adminExtra.message147")}
              </p>
            )}
          </aside>

          <div className={tripRequestsStyles["request-admin-stage"]}>
            {selected ? (
              <article
                className={`${tripRequestsStyles["request-admin-ticket"]} is-${selected.state}`}
              >
                <header
                  className={tripRequestsStyles["request-admin-ticket-head"]}
                >
                  <div>
                    <span>{requestStateLabels[selected.state]}</span>
                    <h2>{selected.places.join(" · ")}</h2>
                    <p>
                      {selected.requester.name} · {selected.requester.email}
                    </p>
                  </div>
                  <div className={tripRequestsStyles["request-admin-actions"]}>
                    {selected.state === "open" && (
                      <>
                        <Button
                          variant="primary"
                          type="button"
                          disabled={busy}
                          onClick={startTrip}
                        >
                          {t("adminExtra.message148")}
                        </Button>
                        <Button
                          variant="danger"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setDeclineReason("");
                            setCreatingTrip(false);
                          }}
                        >
                          {t("adminExtra.message142")}
                        </Button>
                      </>
                    )}
                    {selected.state === "declined" && (
                      <Button
                        variant="primary"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              api(`/api/admin/trip-requests/${selected.id}`, {
                                method: "PATCH",
                                body: JSON.stringify({ action: "restore" }),
                              }),
                            t("adminExtra.message149"),
                          )
                        }
                      >
                        {t("adminExtra.message150")}
                      </Button>
                    )}
                    {selected.state === "fulfilled" && (
                      <Button
                        variant="danger"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(t("adminExtra.message151")))
                            run(
                              () =>
                                api(
                                  `/api/admin/trip-requests/${selected.id}/fulfillment`,
                                  { method: "DELETE" },
                                ),
                              t("adminExtra.message152"),
                            );
                        }}
                      >
                        {t("adminExtra.message153")}
                      </Button>
                    )}
                  </div>
                </header>

                {selected.state === "open" && !creatingTrip && (
                  <form
                    className={tripRequestsStyles["request-attach-strip"]}
                    onSubmit={(event) => {
                      event.preventDefault();
                      run(
                        () =>
                          api(
                            `/api/admin/trip-requests/${selected.id}/fulfillment`,
                            {
                              method: "PUT",
                              body: JSON.stringify({ tripSlug: attachSlug }),
                            },
                          ),
                        t("adminExtra.message154"),
                      );
                    }}
                  >
                    <label>
                      {t("adminExtra.message155")}{" "}
                      <select
                        value={attachSlug}
                        onChange={(event) => setAttachSlug(event.target.value)}
                        disabled={!trips.length}
                      >
                        {trips.map((trip) => (
                          <option value={trip.slug} key={trip.slug}>
                            {trip.title} ·{" "}
                            {formatRequestDate(trip.startDate, intlLocale)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button variant="ghost" disabled={busy || !trips.length}>
                      {busy
                        ? t("adminExtra.message156")
                        : t("adminExtra.message157")}
                    </Button>
                  </form>
                )}

                {declineReason !== null && selected.state === "open" && (
                  <form
                    className={tripRequestsStyles["request-decline-form"]}
                    onSubmit={(event) => {
                      event.preventDefault();
                      run(
                        () =>
                          api(`/api/admin/trip-requests/${selected.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              action: "decline",
                              reason: declineReason,
                            }),
                          }),
                        t("adminExtra.message158"),
                      ).then((result) => {
                        if (result) setDeclineReason(null);
                      });
                    }}
                  >
                    <label>
                      {t("adminExtra.message159")}{" "}
                      <textarea
                        rows={3}
                        maxLength={300}
                        value={declineReason}
                        placeholder={t("adminExtra.message160")}
                        onChange={(event) =>
                          setDeclineReason(event.target.value)
                        }
                      />
                      <span>{declineReason.length}/300</span>
                    </label>
                    <div>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => setDeclineReason(null)}
                      >
                        {t("adminExtra.message161")}
                      </Button>
                      <Button variant="danger" disabled={busy}>
                        {busy
                          ? t("adminExtra.message133")
                          : t("adminExtra.message162")}
                      </Button>
                    </div>
                  </form>
                )}

                {creatingTrip && tripDraft && selected.state === "open" && (
                  <form
                    className={tripRequestsStyles["request-trip-editor"]}
                    onSubmit={createTrip}
                  >
                    <div className={adminShellStyles["admin-section-head"]}>
                      <div>
                        <h3>{t("adminExtra.message163")}</h3>
                        <p> {t("adminExtra.message164")} </p>
                      </div>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => {
                          setCreatingTrip(false);
                          setTripDraft(null);
                        }}
                      >
                        {t("adminExtra.message165")}
                      </Button>
                    </div>
                    <div className={scheduleEditorStyles["form-grid"]}>
                      <label>
                        {t("adminExtra.message166")}{" "}
                        <input
                          required
                          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                          value={tripDraft.slug}
                          placeholder="kamakura-2026-10-10"
                          onChange={(event) =>
                            setTripDraft({
                              ...tripDraft,
                              slug: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        {t("adminExtra.message167")}{" "}
                        <input
                          required
                          maxLength={160}
                          value={tripDraft.title}
                          onChange={(event) =>
                            setTripDraft({
                              ...tripDraft,
                              title: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        {t("adminExtra.message168")}{" "}
                        <input
                          required
                          type="date"
                          value={tripDraft.startDate}
                          onChange={(event) =>
                            setTripDraft({
                              ...tripDraft,
                              startDate: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        {t("adminExtra.message169")}{" "}
                        <input
                          required
                          type="date"
                          min={tripDraft.startDate}
                          value={tripDraft.endDate}
                          onChange={(event) =>
                            setTripDraft({
                              ...tripDraft,
                              endDate: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        {t("adminExtra.message170")}{" "}
                        <input
                          required
                          value={tripDraft.timezone}
                          onChange={(event) =>
                            setTripDraft({
                              ...tripDraft,
                              timezone: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="wide">
                        {t("adminExtra.message171")}{" "}
                        <input
                          required
                          maxLength={160}
                          value={tripDraft.location}
                          onChange={(event) =>
                            setTripDraft({
                              ...tripDraft,
                              location: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <Footer>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => {
                          setCreatingTrip(false);
                          setTripDraft(null);
                        }}
                      >
                        {t("adminExtra.message161")}
                      </Button>
                      <Button variant="primary" disabled={busy}>
                        {busy
                          ? t("adminExtra.message090")
                          : t("adminExtra.message172")}
                      </Button>
                    </Footer>
                  </form>
                )}

                <TripRequestDetails request={selected} admin />
              </article>
            ) : (
              <div className={tripRequestsStyles["request-stage-empty"]}>
                <h2>{t("adminExtra.message173")}</h2>
                <p>{t("adminExtra.message174")}</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
