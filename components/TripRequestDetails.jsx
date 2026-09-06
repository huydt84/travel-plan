import tripRequestsStyles from "../src/styles/trip-requests.module.css";
import Link from "next/link";
import { ActionIcon } from "./Icons";
import { useLocale } from "./LocaleProvider";

export const requestStateLabels = {
  open: "Đang chờ",
  fulfilled: "Đã có lịch",
  declined: "Không thực hiện",
  withdrawn: "Đã rút",
};
export const requestStateKey = (state) => `requests.status.${state}`;

const dateOptions = {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
};

export const formatRequestDate = (value, locale = "vi-VN") =>
  new Intl.DateTimeFormat(locale, dateOptions).format(new Date(`${value}T00:00:00Z`));
export const formatRequestRange = (request, locale = "vi-VN") =>
  request.startDate === request.endDate
    ? formatRequestDate(request.startDate, locale)
    : `${formatRequestDate(request.startDate, locale)} — ${formatRequestDate(request.endDate, locale)}`;

export default function TripRequestDetails({ request, admin = false }) {
  const { t, intlLocale } = useLocale();
  return (
    <div className={tripRequestsStyles["request-detail-body"]}>
      <div className={tripRequestsStyles["request-date-board"]}>
        <span>{t("requests.desiredDates")}</span>
        <strong>{formatRequestRange(request, intlLocale)}</strong>
      </div>

      <section
        className={tripRequestsStyles["request-route"]}
        aria-labelledby={`request-${request.id}-places`}
      >
        <h3 id={`request-${request.id}-places`}>
          {t("requests.placesCount", { count: request.places.length })}
        </h3>
        <ol>
          {request.places.map((place, index) => (
            <li key={`${place}-${index}`}>
              <span aria-hidden="true" />
              <b>{place}</b>
            </li>
          ))}
        </ol>
      </section>

      {request.notes && (
        <section className={tripRequestsStyles["request-notes"]}>
          <h3>{t("requests.notesForPlanner")}</h3>
          <p>{request.notes}</p>
        </section>
      )}

      <section
        className={tripRequestsStyles["request-sources"]}
        aria-labelledby={`request-${request.id}-sources`}
      >
        <h3 id={`request-${request.id}-sources`}>{t("requests.referenceSources")}</h3>
        {request.sources.length ? (
          <ol>
            {request.sources.map((source, index) => (
              <li key={`${source.url}-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <a href={source.url} target="_blank" rel="noreferrer">
                  <b>{source.label || new URL(source.url).hostname}</b>
                  <small>{new URL(source.url).hostname}</small>
                  <ActionIcon name="external" />
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <p>{t("requests.noReferences")}</p>
        )}
      </section>

      {request.state === "declined" && (
        <div className={tripRequestsStyles["request-decision"]} role="note">
          <strong>{t("requests.declinedTitle")}</strong>
          <p>{request.decisionReason || t("requests.noDecisionReason")}</p>
        </div>
      )}

      {request.trip && (
        <div className={tripRequestsStyles["request-fulfillment"]}>
          <div>
            <span>{t("requests.scheduleReady")}</span>
            <strong>{request.trip.title}</strong>
          </div>
          <Link href={`/?trip=${encodeURIComponent(request.trip.slug)}`}>
            {t("requests.viewSchedule")} <ActionIcon name="right" />
          </Link>
        </div>
      )}

      {admin && (
        <dl className={tripRequestsStyles["request-audit"]}>
          <div>
            <dt>{t("requests.requester")}</dt>
            <dd>
              {request.requester.name}
              <small>{request.requester.email}</small>
            </dd>
          </div>
          <div>
            <dt>{t("requests.requestId")}</dt>
            <dd>#{request.id}</dd>
          </div>
          <div>
            <dt>{t("requests.status")}</dt>
            <dd>{t(`requests.status.${request.state}`)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
