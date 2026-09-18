import { DateTime } from "luxon";
import { isActivityDateRangeExempt } from "./activity-types.mjs";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const isIsoDate = (value) => {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = DateTime.fromISO(value, { zone: "UTC" });
  return parsed.isValid && parsed.toISODate() === value;
};

export const isIsoTime = (value) => typeof value === "string" && ISO_TIME.test(value);

const plainDate = (value) => {
  const parsed = DateTime.fromISO(value, { zone: "UTC" });
  if (!isIsoDate(value) || !parsed.isValid) throw new TypeError(`Invalid ISO date: ${value}`);
  return parsed;
};

export const addCalendarDays = (date, days) => plainDate(date).plus({ days }).toISODate();

export const calendarDayDifference = (startDate, endDate) => Math.round(
  plainDate(endDate).diff(plainDate(startDate), "days").days,
);

export const enumerateTripDays = (startDate, endDate) => {
  const difference = calendarDayDifference(startDate, endDate);
  if (difference < 0) throw new RangeError("Trip end date must not be before its start date");
  return Array.from({ length: difference + 1 }, (_, index) => addCalendarDays(startDate, index));
};

export const compareActivityDateTime = (left, right) => (
  left.startDate.localeCompare(right.startDate)
  || left.start.localeCompare(right.start)
  || left.endDate.localeCompare(right.endDate)
  || left.end.localeCompare(right.end)
  || String(left.key || left.id || "").localeCompare(String(right.key || right.id || ""))
);

export const validateActivityInterval = ({ startDate, start, endDate, end, type }, { trip = null } = {}) => {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) throw new RangeError("Activity dates must use YYYY-MM-DD");
  if (!isIsoTime(start) || !isIsoTime(end)) throw new RangeError("Activity times must use HH:MM");
  const daySpan = calendarDayDifference(startDate, endDate);
  if (daySpan < 0 || daySpan > 1) throw new RangeError("Activity must end on its start date or the following date");
  if (daySpan === 0 && end <= start) throw new RangeError("Same-day activity end must be later than its start");
  if (trip && !isActivityDateRangeExempt(type) && (startDate < trip.startDate || endDate > trip.endDate)) {
    throw new RangeError("Activity must stay within the trip date range");
  }
  return true;
};

export const zonedDateTime = (date, time, timezone) => {
  if (!isIsoDate(date) || !isIsoTime(time)) throw new RangeError("Date and time must use YYYY-MM-DD and HH:MM");
  const input = `${date}T${time}`;
  const parsed = DateTime.fromISO(input, { zone: timezone, setZone: true });
  if (!parsed.isValid) throw new RangeError(`Invalid local date/time for ${timezone}`);
  if (parsed.toFormat("yyyy-MM-dd'T'HH:mm") !== input) {
    throw new RangeError(`Local time ${input} does not exist in ${timezone}`);
  }
  const possibilities = parsed.getPossibleOffsets();
  return [...possibilities].sort((left, right) => left.toMillis() - right.toMillis())[0].toJSDate();
};

export const activityInstants = (activity, timezone) => ({
  startAt: zonedDateTime(activity.startDate, activity.start, timezone),
  endAt: zonedDateTime(activity.endDate, activity.end, timezone),
});

export const currentDateInTimezone = (now, timezone) => DateTime.fromJSDate(
  now instanceof Date ? now : new Date(now),
  { zone: timezone },
).toISODate();

export const formatDateLabel = (date, timezone, options = {}, locale = "vi-VN") => new Intl.DateTimeFormat(locale, options.dateStyle ? {
  timeZone: timezone,
  ...options,
} : {
  timeZone: timezone,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  ...options,
}).format(zonedDateTime(date, "12:00", timezone));

export const formatTripDateRange = (trip, options = {}, locale = "vi-VN") => {
  const start = formatDateLabel(trip.startDate, trip.timezone, options, locale);
  if (trip.startDate === trip.endDate) return start;
  return `${start} – ${formatDateLabel(trip.endDate, trip.timezone, options, locale)}`;
};
