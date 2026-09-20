import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LOCALE_COOKIE, LOCALE_META, normalizeLocale, translate } from "../../../lib/i18n.mjs";
import { getItinerary } from "../../../lib/itinerary-repository";
import { projectSharedItinerary } from "../../../lib/trip-share.mjs";
import { resolveTripShareLink } from "../../../lib/trip-share-repository";
import SharedTripActions from "../../../components/SharedTripActions";
import SharedExpiryTime from "../../../components/SharedExpiryTime";
import LanguageSwitcher from "../../../components/LanguageSwitcher";
import styles from "../../../components/shared-trip.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { robots: { index: false, follow: false } };

export default async function SharedTripPage({ params }) {
  const { token } = await params;
  const locale = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = (key, values) => translate(locale, key, values);
  const link = await resolveTripShareLink(token);
  if (!link) notFound();

  const data = projectSharedItinerary(await getItinerary(link.slug));
  const dateFormatter = new Intl.DateTimeFormat(LOCALE_META[locale].intl, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const dayLabel = (date) => dateFormatter.format(new Date(`${date}T00:00:00Z`));
  const days = [...new Set(data.itinerary.map((item) => item.startDate))];
  const sources = new Map(data.sources.map((source) => [source.number, source]));

  return <main className={styles.shell}>
    <header className={styles.topbar}><span className={styles.brand}>TRAVEL PLAN / {t("share.kicker")}</span><LanguageSwitcher /></header>
    <div className={styles.hero}>
      <div><span className={styles.kicker}>{t("share.readOnly")}</span><h1>{data.trip.title}</h1><p>{data.trip.location} · {dayLabel(data.trip.startDate)}{data.trip.endDate !== data.trip.startDate && ` – ${dayLabel(data.trip.endDate)}`}</p></div>
      <aside><strong>{t("share.duration", { minutes: link.minutes })}</strong><SharedExpiryTime expiresAt={link.expiresAt} intlLocale={LOCALE_META[locale].intl} label={t("share.expiresAt", { time: "{time}" })} /></aside>
    </div>
    <SharedTripActions itinerary={data} />
    <div className={styles.schedule}>
      {days.length ? days.map((day, index) => <section key={day} className={styles.day} aria-labelledby={`day-${index}`}>
        <div className={styles.dayHeading}><span>{String(index + 1).padStart(2, "0")}</span><h2 id={`day-${index}`}>{dayLabel(day)}</h2></div>
        <ol>{data.itinerary.filter((item) => item.startDate === day).map((item, itemIndex) => <li key={`${day}-${itemIndex}`} className={styles.activity}>
          <time>{item.start}<small>{item.displayEnd || `${item.endDate !== item.startDate ? `${item.endDate} ` : ""}${item.end}`}</small></time>
          <div><h3>{item.title}</h3>{item.detail && <p>{item.detail}</p>}{item.refs.length > 0 && <div className={styles.refs}>{item.refs.map((number) => sources.has(number) && <a key={number} href={sources.get(number).url} target="_blank" rel="noreferrer" referrerPolicy="no-referrer">[{number}] {sources.get(number).title}</a>)}</div>}</div>
        </li>)}</ol>
      </section>) : <p className={styles.empty}>{t("share.empty")}</p>}
    </div>
    {data.sources.length > 0 && <section className={styles.sourceIndex}><h2>{t("share.sources")}</h2><ol>{data.sources.map((source) => <li key={source.number}><span>[{source.number}]</span><a href={source.url} target="_blank" rel="noreferrer" referrerPolicy="no-referrer">{source.title}</a></li>)}</ol></section>}
  </main>;
}
