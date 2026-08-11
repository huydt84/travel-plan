const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const fail = (message) => { throw new Error(`Invalid import: ${message}`); };
const object = (value, field) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  return value;
};
const text = (value, field, max = 500) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail(`${field} must be a non-empty string up to ${max} characters`);
  return value.trim();
};

export const slugify = (value) => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 100) || "activity";

export function assignItemKeys(items) {
  const seen = new Map();
  return items.map((item) => {
    const base = item.key ? slugify(item.key) : slugify(item.title);
    const occurrence = (seen.get(base) || 0) + 1;
    seen.set(base, occurrence);
    return { ...item, key: occurrence === 1 ? base : `${base}-${occurrence}` };
  });
}

export function normalizeTripImport(raw) {
  object(raw, "root");
  const rawTrip = object(raw.trip, "trip");
  const trip = {
    slug: text(rawTrip.slug, "trip.slug", 100),
    title: text(rawTrip.title, "trip.title", 160),
    date: text(rawTrip.date, "trip.date", 10),
    timezone: text(rawTrip.timezone || "Asia/Tokyo", "trip.timezone", 80),
    location: text(rawTrip.location, "trip.location", 160),
  };
  if (!slugPattern.test(trip.slug)) fail("trip.slug must use lowercase letters, numbers and single hyphens");
  if (!datePattern.test(trip.date) || Number.isNaN(Date.parse(`${trip.date}T00:00:00Z`))) fail("trip.date must use YYYY-MM-DD");
  try { new Intl.DateTimeFormat("en", { timeZone: trip.timezone }).format(); }
  catch { fail("trip.timezone must be a valid IANA timezone"); }

  const rawSources = raw.sources ?? [];
  if (!Array.isArray(rawSources)) fail("sources must be an array");
  const sourceNumbers = new Set();
  const sources = rawSources.map((value, index) => {
    const source = object(value, `sources[${index}]`);
    if (!Number.isInteger(source.number) || source.number <= 0 || sourceNumbers.has(source.number)) fail(`sources[${index}].number must be a unique positive integer`);
    sourceNumbers.add(source.number);
    const url = text(source.url, `sources[${index}].url`, 2000);
    let inferredHost;
    try { inferredHost = new URL(url).hostname.replace(/^www\./, ""); }
    catch { fail(`sources[${index}].url must be a valid URL`); }
    return {
      number: source.number,
      title: text(source.title, `sources[${index}].title`, 300),
      host: source.host ? text(source.host, `sources[${index}].host`, 200) : inferredHost,
      url,
    };
  });

  const rawSchedule = raw.schedule ?? raw.itinerary;
  if (!Array.isArray(rawSchedule) || !rawSchedule.length) fail("schedule must be a non-empty array");
  const schedule = assignItemKeys(rawSchedule.map((value, index) => {
    const item = object(value, `schedule[${index}]`);
    const start = text(item.start, `schedule[${index}].start`, 5);
    const end = text(item.end, `schedule[${index}].end`, 5);
    if (!timePattern.test(start) || !timePattern.test(end)) fail(`schedule[${index}] times must use HH:MM`);
    if (end <= start) fail(`schedule[${index}].end must be later than start`);
    const refs = item.refs == null ? [] : item.refs;
    if (!Array.isArray(refs) || refs.some((ref) => !Number.isInteger(ref) || !sourceNumbers.has(ref))) fail(`schedule[${index}].refs must only contain source numbers declared in sources`);
    return {
      key: item.key ? text(item.key, `schedule[${index}].key`, 120) : null,
      start,
      end,
      displayEnd: item.displayEnd == null ? null : text(item.displayEnd, `schedule[${index}].displayEnd`, 20),
      type: text(item.type, `schedule[${index}].type`, 40),
      icon: text(item.icon, `schedule[${index}].icon`, 16),
      title: text(item.title, `schedule[${index}].title`, 240),
      detail: text(item.detail, `schedule[${index}].detail`, 2000),
      refs: [...new Set(refs)],
    };
  }));

  for (let index = 1; index < schedule.length; index += 1) {
    if (schedule[index].start < schedule[index - 1].start) fail("schedule must be ordered by start time");
  }
  return { trip, sources, schedule };
}
