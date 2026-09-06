const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RELATIVE_TITLE_SUFFIX = /,\s*(?:hôm qua|hôm nay|ngày mai|(?:ngày\s+)?\d{2}\/\d{2}\/\d{4})\s*$/iu;

const parseDate = (date) => {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new TypeError(`Invalid trip date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
};

const dateInTimezone = (now, timezone) => Object.fromEntries(
  new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]),
);

const epochDay = ({ year, month, day }) => Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86_400_000;

const relativeDateLabel = (date, timezone, now) => {
  const tripDate = parseDate(date);
  const difference = epochDay(tripDate) - epochDay(dateInTimezone(now, timezone));

  if (difference === -1) return "hôm qua";
  if (difference === 0) return "hôm nay";
  if (difference === 1) return "ngày mai";

  return `ngày ${String(tripDate.day).padStart(2, "0")}/${String(tripDate.month).padStart(2, "0")}/${tripDate.year}`;
};

const absoluteDate = (date) => {
  const parsed = parseDate(date);
  return `${String(parsed.day).padStart(2, "0")}/${String(parsed.month).padStart(2, "0")}/${parsed.year}`;
};

const relativeDateLabelForLocale = (date, timezone, now, locale) => {
  const tripDate = parseDate(date);
  const difference = epochDay(tripDate) - epochDay(dateInTimezone(now, timezone));
  if (locale === "en") {
    if (difference === -1) return "yesterday";
    if (difference === 0) return "today";
    if (difference === 1) return "tomorrow";
    return localizedAbsoluteDate(date, "en-US");
  }
  if (locale === "ja") {
    if (difference === -1) return "昨日";
    if (difference === 0) return "今日";
    if (difference === 1) return "明日";
    return localizedAbsoluteDate(date, "ja-JP");
  }
  return relativeDateLabel(date, timezone, now);
};

// A calendar date is not an instant: format in UTC so extreme offsets cannot shift it.
const localizedAbsoluteDate = (date, locale) => {
  const parsed = parseDate(date);
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "short" })
    .format(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)));
};

export const relativeTripDateLabel = (startDate, endDate, timezone, now = new Date(), locale = "vi") => {
  if (startDate === endDate) return relativeDateLabelForLocale(startDate, timezone, now, locale);
  const today = epochDay(dateInTimezone(now, timezone));
  if (today >= epochDay(parseDate(startDate)) && today <= epochDay(parseDate(endDate))) {
    return locale === "en" ? "in progress" : locale === "ja" ? "進行中" : "đang diễn ra";
  }
  if (locale === "en") {
    return `${localizedAbsoluteDate(startDate, "en-US")}-${localizedAbsoluteDate(endDate, "en-US")}`;
  }
  if (locale === "ja") {
    return `${localizedAbsoluteDate(startDate, "ja-JP")}〜${localizedAbsoluteDate(endDate, "ja-JP")}`;
  }
  return `${absoluteDate(startDate)}–${absoluteDate(endDate)}`;
};

export const formatTripTitle = (title, startDate, timezone, now = new Date(), endDate = startDate, locale = "vi") => {
  const suffix = title.match(RELATIVE_TITLE_SUFFIX);
  if (!suffix) return title;

  return `${title.slice(0, suffix.index)}, ${relativeTripDateLabel(startDate, endDate, timezone, now, locale)}`;
};

export const formatScheduleHeading = (startDate, timezone, now = new Date(), endDate = startDate, locale = "vi") =>
  `${locale === "en" ? "Schedule" : locale === "ja" ? "スケジュール" : "Lịch"} ${relativeTripDateLabel(startDate, endDate, timezone, now, locale)}`;
