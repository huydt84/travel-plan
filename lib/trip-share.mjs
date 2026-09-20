export function projectSharedItinerary(plan) {
  const sourceNumbers = new Set(plan.itinerary.flatMap((item) => item.refs || []));
  return {
    trip: {
      title: plan.trip.title,
      startDate: plan.trip.startDate,
      endDate: plan.trip.endDate,
      timezone: plan.trip.timezone,
      location: plan.trip.location,
    },
    itinerary: plan.itinerary.map((item) => ({
      startDate: item.startDate,
      start: item.start,
      endDate: item.endDate,
      end: item.end,
      displayEnd: item.displayEnd,
      title: item.title,
      detail: item.detail,
      refs: item.refs || [],
    })),
    sources: plan.sources.filter((source) => sourceNumbers.has(source.number)).map((source) => ({
      number: source.number,
      title: source.title,
      url: source.url,
    })),
  };
}

export function sharedItineraryText(data, labels) {
  const dateRange = data.trip.startDate === data.trip.endDate ? data.trip.startDate : `${data.trip.startDate} – ${data.trip.endDate}`;
  const lines = [data.trip.title, `${dateRange} · ${data.trip.location}`];
  let currentDay = "";
  for (const item of data.itinerary) {
    if (item.startDate !== currentDay) {
      currentDay = item.startDate;
      lines.push("", `${labels.day} ${currentDay}`);
    }
    const end = item.displayEnd || `${item.endDate !== item.startDate ? `${item.endDate} ` : ""}${item.end}`;
    lines.push(`${item.start}–${end}  ${item.title}`);
    if (item.detail?.trim()) lines.push(item.detail.trim());
    if (item.refs.length) lines.push(`${labels.sources}: ${item.refs.map((number) => `[${number}]`).join(", ")}`);
  }
  if (data.sources.length) {
    lines.push("", labels.sources);
    for (const source of data.sources) lines.push(`[${source.number}] ${source.title}: ${source.url}`);
  }
  return lines.join("\n");
}

const escapeMarkdown = (value) => String(value ?? "").replace(/([\\`*_{}\[\]()#+.!|>~-])/g, "\\$1");

export function sharedItineraryMarkdown(data, labels) {
  const dateRange = data.trip.startDate === data.trip.endDate ? data.trip.startDate : `${data.trip.startDate} – ${data.trip.endDate}`;
  const lines = [`# ${escapeMarkdown(data.trip.title)}`, "", `${escapeMarkdown(dateRange)} · ${escapeMarkdown(data.trip.location)}`];
  let currentDay = "";
  for (const item of data.itinerary) {
    if (item.startDate !== currentDay) {
      currentDay = item.startDate;
      lines.push("", `## ${escapeMarkdown(labels.day)} ${escapeMarkdown(currentDay)}`, "");
    }
    const end = item.displayEnd || `${item.endDate !== item.startDate ? `${item.endDate} ` : ""}${item.end}`;
    lines.push(`- **${escapeMarkdown(item.start)}–${escapeMarkdown(end)}** ${escapeMarkdown(item.title)}`);
    if (item.detail?.trim()) lines.push(...item.detail.trim().split("\n").map((line) => `  ${escapeMarkdown(line)}`));
    if (item.refs.length) lines.push(`  ${escapeMarkdown(labels.sources)}: ${item.refs.map((number) => `[${number}]`).join(", ")}`);
  }
  if (data.sources.length) {
    lines.push("", `## ${escapeMarkdown(labels.sources)}`, "");
    for (const source of data.sources) lines.push(`- [${source.number}] ${escapeMarkdown(source.title)}: ${source.url}`);
  }
  return `${lines.join("\n")}\n`;
}
