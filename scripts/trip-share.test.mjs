import test from "node:test";
import assert from "node:assert/strict";
import { projectSharedItinerary, sharedItineraryMarkdown, sharedItineraryText } from "../lib/trip-share.mjs";

test("shared itinerary includes the selected schedule and cited sources only", () => {
  const shared = projectSharedItinerary({
    trip: { title: "Kyoto", startDate: "2030-04-01", endDate: "2030-04-01", timezone: "Asia/Tokyo", location: "Kyoto", currency: "JPY" },
    itinerary: [{ startDate: "2030-04-01", start: "09:00", endDate: "2030-04-01", end: "10:00", title: "Temple", detail: "East gate", refs: [2], reservationContacts: [{ email: "private@example.com" }], placeId: "42" }],
    sources: [{ number: 2, title: "Official", url: "https://example.com" }, { number: 3, title: "Unused", url: "https://unused.example.com" }],
    places: [{ name: "Private place" }],
    branchGroups: [{ title: "Unused branch" }],
  });
  assert.deepEqual(Object.keys(shared).sort(), ["itinerary", "sources", "trip"]);
  assert.deepEqual(shared.sources.map((source) => source.number), [2]);
  assert.equal(JSON.stringify(shared).includes("private@example.com"), false);
  assert.equal(JSON.stringify(shared).includes("Unused branch"), false);
  assert.equal(JSON.stringify(shared).includes("JPY"), false);
  const copied = sharedItineraryText(shared, { day: "Ngày", sources: "Nguồn tham khảo" });
  assert.match(copied, /09:00–10:00  Temple/);
  assert.match(copied, /East gate/);
  assert.match(copied, /https:\/\/example.com/);
});

test("Markdown export keeps days, details, and cited sources", () => {
  const markdown = sharedItineraryMarkdown({
    trip: { title: "Kyoto *spring*", startDate: "2030-04-01", endDate: "2030-04-02", location: "Kyoto" },
    itinerary: [
      { startDate: "2030-04-01", start: "09:00", endDate: "2030-04-01", end: "10:00", title: "Temple [visit]", detail: "East gate\nBring tickets", refs: [2] },
      { startDate: "2030-04-02", start: "08:00", endDate: "2030-04-02", end: "09:00", title: "Breakfast", detail: "", refs: [] },
    ],
    sources: [{ number: 2, title: "Official guide", url: "https://example.com/temple" }],
  }, { day: "Day", sources: "Sources" });
  assert.match(markdown, /^# Kyoto \\\*spring\\\*/);
  assert.match(markdown, /## Day 2030\\-04\\-01/);
  assert.match(markdown, /- \*\*09:00–10:00\*\* Temple \\\[visit\\\]/);
  assert.match(markdown, /  East gate\n  Bring tickets\n  Sources: \[2\]/);
  assert.match(markdown, /\[2\] Official guide: https:\/\/example.com\/temple/);
});
