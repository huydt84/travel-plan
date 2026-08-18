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

  const parseActivity = (value, field, { allowBranch = true } = {}) => {
    const item = object(value, field);
    if (!allowBranch && item.branchGroup != null) fail(`${field}.branchGroup cannot be nested`);
    const start = text(item.start, `${field}.start`, 5);
    const end = text(item.end, `${field}.end`, 5);
    if (!timePattern.test(start) || !timePattern.test(end)) fail(`${field} times must use HH:MM`);
    if (end <= start) fail(`${field}.end must be later than start`);
    const refs = item.refs == null ? [] : item.refs;
    if (!Array.isArray(refs) || refs.some((ref) => !Number.isInteger(ref) || !sourceNumbers.has(ref))) fail(`${field}.refs must only contain source numbers declared in sources`);
    return {
      key: item.key ? text(item.key, `${field}.key`, 120) : null,
      start,
      end,
      displayEnd: item.displayEnd == null ? null : text(item.displayEnd, `${field}.displayEnd`, 20),
      type: text(item.type, `${field}.type`, 40),
      icon: text(item.icon, `${field}.icon`, 16),
      title: text(item.title, `${field}.title`, 240),
      detail: text(item.detail, `${field}.detail`, 2000),
      refs: [...new Set(refs)],
      branchGroup: allowBranch && item.branchGroup ? parseBranchGroup(item.branchGroup, `${field}.branchGroup`) : null,
    };
  };

  const parseBranchGroup = (value, field) => {
    const group = object(value, field);
    if (!Array.isArray(group.branches) || group.branches.length < 2) fail(`${field}.branches must contain at least two branches`);
    const branches = group.branches.map((value, branchIndex) => {
      const branchField = `${field}.branches[${branchIndex}]`;
      const branch = object(value, branchField);
      const rawBranchSchedule = branch.schedule ?? [];
      if (!Array.isArray(rawBranchSchedule)) fail(`${branchField}.schedule must be an array`);
      const branchSchedule = rawBranchSchedule.map((item, itemIndex) => parseActivity(item, `${branchField}.schedule[${itemIndex}]`, { allowBranch: false }));
      for (let index = 1; index < branchSchedule.length; index += 1) {
        if (branchSchedule[index].start < branchSchedule[index - 1].end) fail(`${branchField}.schedule must be ordered without overlaps`);
      }
      return {
        key: branch.key ? text(branch.key, `${branchField}.key`, 120) : slugify(text(branch.label, `${branchField}.label`, 80)),
        label: text(branch.label, `${branchField}.label`, 80),
        condition: text(branch.condition, `${branchField}.condition`, 240),
        schedule: branchSchedule,
      };
    });
    if (new Set(branches.map((branch) => branch.key)).size !== branches.length) fail(`${field}.branches keys must be unique`);
    const defaultBranchKey = text(group.defaultBranchKey, `${field}.defaultBranchKey`, 120);
    if (!branches.some((branch) => branch.key === defaultBranchKey)) fail(`${field}.defaultBranchKey must match a branch key`);
    return {
      key: group.key ? text(group.key, `${field}.key`, 120) : slugify(text(group.title, `${field}.title`, 160)),
      title: text(group.title, `${field}.title`, 160),
      defaultBranchKey,
      branches,
    };
  };

  const rawSchedule = raw.schedule ?? raw.itinerary;
  if (!Array.isArray(rawSchedule) || !rawSchedule.length) fail("schedule must be a non-empty array");
  const startBranchGroup = raw.startBranchGroup == null ? null : parseBranchGroup(raw.startBranchGroup, "startBranchGroup");
  const schedule = rawSchedule.map((value, index) => parseActivity(value, `schedule[${index}]`));

  const seenItemKeys = new Map();
  const withStableKey = (item) => {
    const base = item.key ? slugify(item.key) : slugify(item.title);
    const occurrence = (seenItemKeys.get(base) || 0) + 1;
    seenItemKeys.set(base, occurrence);
    const keyed = { ...item, key: occurrence === 1 ? base : `${base}-${occurrence}` };
    if (!keyed.branchGroup) return keyed;
    return {
      ...keyed,
      branchGroup: {
        ...keyed.branchGroup,
        branches: keyed.branchGroup.branches.map((branch) => ({
          ...branch,
          schedule: branch.schedule.map(withStableKey),
        })),
      },
    };
  };
  const keyedStartBranchGroup = startBranchGroup ? {
    ...startBranchGroup,
    branches: startBranchGroup.branches.map((branch) => ({
      ...branch,
      schedule: branch.schedule.map(withStableKey),
    })),
  } : null;
  const keyedSchedule = schedule.map(withStableKey);

  for (let index = 1; index < keyedSchedule.length; index += 1) {
    if (keyedSchedule[index].start < keyedSchedule[index - 1].start) fail("schedule must be ordered by start time");
  }
  for (const [index, item] of keyedSchedule.entries()) {
    if (!item.branchGroup) continue;
    const rejoin = keyedSchedule[index + 1] || null;
    for (const branch of item.branchGroup.branches) {
      if (branch.schedule[0] && branch.schedule[0].start < item.end) fail(`branch ${branch.key} starts before its anchor ends`);
      if (rejoin && branch.schedule.at(-1)?.end > rejoin.start) fail(`branch ${branch.key} ends after its rejoin activity starts`);
    }
  }
  if (keyedStartBranchGroup) {
    const firstSharedActivity = keyedSchedule[0];
    for (const branch of keyedStartBranchGroup.branches) {
      if (branch.schedule.at(-1)?.end > firstSharedActivity.start) fail(`start branch ${branch.key} ends after its first shared activity starts`);
    }
  }
  return { trip, sources, schedule: keyedSchedule, startBranchGroup: keyedStartBranchGroup };
}
