import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { getIntlLocale, localeMessages, normalizeLocale, translate, translateActivityType } from "../lib/i18n.mjs";
import { formatDateLabel } from "../lib/trip-dates.mjs";
import { relativeTripDateLabel } from "../lib/trip-date-label.mjs";

test("normalizes supported, regional, and unknown locales", () => {
  assert.equal(normalizeLocale("vi"), "vi");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("JA-jp"), "ja");
  assert.equal(normalizeLocale("fr"), "vi");
  assert.equal(normalizeLocale(null), "vi");
});

test("translates with interpolation and Vietnamese fallback", () => {
  assert.equal(translate("en", "tracker.day", { number: 2 }), "Day 2");
  assert.equal(translate("ja", "tracker.activities", { count: 3 }), "3件の予定");
  assert.equal(translate("en", "missing.key"), "missing.key");
  assert.equal(translate("en", "toString"), "toString");
  assert.equal(translate("unknown", "tracker.day", { number: 2 }), "Ngày 2");
  assert.equal(getIntlLocale("ja-JP"), "ja-JP");
});

test("every language has the complete catalog and matching interpolation parameters", () => {
  const keys = Object.keys(localeMessages.vi).sort();
  const parameters = (message) => [...new Set(message.match(/\{[^{}]+\}/g) || [])].sort();
  for (const locale of ["en", "ja"]) {
    assert.deepEqual(Object.keys(localeMessages[locale]).sort(), keys, `${locale} catalog coverage`);
    for (const key of keys) {
      assert.ok(localeMessages[locale][key].trim(), `${locale}:${key} is empty`);
      assert.deepEqual(parameters(localeMessages[locale][key]), parameters(localeMessages.vi[key]), `${locale}:${key} interpolation`);
    }
  }
});

test("static interface translation references resolve in the catalog", async () => {
  const missing = [];
  for (const folder of ["components", "app"]) {
    const root = new URL(`../${folder}/`, import.meta.url);
    for (const path of await readdir(root, { recursive: true })) {
      if (!/\.jsx?$/.test(path)) continue;
      const source = await readFile(new URL(path, root), "utf8");
      for (const [, key] of source.matchAll(/\bt\(\s*["']([^"']+)["']/g)) {
        if (!Object.hasOwn(localeMessages.vi, key)) missing.push(`${folder}/${path}: ${key}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("formats relative trip dates in each locale", () => {
  const now = new Date("2026-09-06T04:00:00.000Z");
  assert.equal(relativeTripDateLabel("2026-09-06", "2026-09-06", "Asia/Tokyo", now, "en"), "today");
  assert.equal(relativeTripDateLabel("2026-09-07", "2026-09-07", "Asia/Tokyo", now, "ja"), "明日");
  assert.match(relativeTripDateLabel("2026-09-20", "2026-09-20", "Asia/Tokyo", now, "en"), /\d/);
});

test("formats schedule dates with a locale while keeping the trip timezone", () => {
  const date = formatDateLabel("2026-09-07", "Asia/Tokyo", { dateStyle: "full" }, "ja-JP");
  assert.match(date, /2026/);
  assert.match(date, /月曜日/);
});

test("calendar labels and ranges do not shift in extreme timezones", () => {
  const now = new Date("2026-09-01T00:00:00Z");
  for (const timezone of ["Pacific/Kiritimati", "Pacific/Apia", "Pacific/Pago_Pago"]) {
    assert.equal(relativeTripDateLabel("2026-09-20", "2026-09-20", timezone, now, "en"), "9/20/26");
    assert.equal(relativeTripDateLabel("2026-09-20", "2026-09-22", timezone, now, "ja"), "2026/09/20〜2026/09/22");
  }
});

test("interpolation preserves placeholder-like and dollar text in authored values", () => {
  assert.equal(translate("en", "notifications.tripLinked", { actor: "$& {trip}", trip: "Kyoto" }),
    "$& {trip} linked “Kyoto” to your request.");
});

test("all editor activity types have Japanese labels and custom types stay unchanged", () => {
  for (const type of ["Transit", "Walk", "Visit", "Film", "Buffer", "Rest", "Cafe", "Lunch", "Dinner", "Picnic", "Indoor"]) {
    assert.notEqual(translateActivityType("ja", type), type);
  }
  assert.equal(translateActivityType("ja", "My custom type"), "My custom type");
});
