export function getTripTrackerState(now, itinerary) {
  const first = itinerary[0];
  const last = itinerary.at(-1);

  if (now < first.startAt) {
    return { mode: "before", current: first, anchor: first, index: -1, next: itinerary[1] || null };
  }

  if (now >= last.endAt) {
    return { mode: "after", current: null, anchor: last, index: itinerary.length, next: null };
  }

  const index = itinerary.findIndex((item) => now >= item.startAt && now < item.endAt);
  if (index >= 0) {
    const current = itinerary[index];
    return { mode: "active", current, anchor: current, index, next: itinerary[index + 1] || null };
  }

  const nextIndex = itinerary.findIndex((item) => now < item.startAt);
  const current = itinerary[nextIndex];
  return { mode: "gap", current, anchor: current, index: nextIndex - 1, next: itinerary[nextIndex + 1] || null };
}
