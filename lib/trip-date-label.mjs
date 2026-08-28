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

export const relativeTripDateLabel = (startDate, endDate, timezone, now = new Date()) => {
  if (startDate === endDate) return relativeDateLabel(startDate, timezone, now);
  const today = epochDay(dateInTimezone(now, timezone));
  if (today >= epochDay(parseDate(startDate)) && today <= epochDay(parseDate(endDate))) return "đang diễn ra";
  return `${absoluteDate(startDate)}–${absoluteDate(endDate)}`;
};

export const formatTripTitle = (title, startDate, timezone, now = new Date(), endDate = startDate) => {
  const suffix = title.match(RELATIVE_TITLE_SUFFIX);
  if (!suffix) return title;

  return `${title.slice(0, suffix.index)}, ${relativeTripDateLabel(startDate, endDate, timezone, now)}`;
};

export const formatScheduleHeading = (startDate, timezone, now = new Date(), endDate = startDate) =>
  `Lịch ${relativeTripDateLabel(startDate, endDate, timezone, now)}`;
