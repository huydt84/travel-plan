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

export const formatTripTitle = (title, date, timezone, now = new Date()) => {
  const suffix = title.match(RELATIVE_TITLE_SUFFIX);
  if (!suffix) return title;

  return `${title.slice(0, suffix.index)}, ${relativeDateLabel(date, timezone, now)}`;
};

export const formatScheduleHeading = (date, timezone, now = new Date()) =>
  `Lịch ${relativeDateLabel(date, timezone, now)}`;
