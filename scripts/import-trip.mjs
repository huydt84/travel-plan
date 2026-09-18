import { applyTripImport, flattenTripImport } from "./trip-import-store.mjs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { signRevalidation } from "../lib/revalidation-signature.mjs";
import { resolveDatabaseConfig, resolveLocalAdminMode } from "../lib/runtime-config.mjs";
import { createSqlAdapter } from "../lib/sql-adapter.mjs";
import { normalizeTripImport } from "./trip-import-utils.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const fileArg = args.find((arg) => !arg.startsWith("--"));
if (!fileArg) {
  console.error("Usage: pnpm run trip:import <trip.json> [--apply]");
  process.exit(1);
}
const localAdmin = resolveLocalAdminMode();

const filePath = resolve(fileArg);
const payload = normalizeTripImport(JSON.parse(await readFile(filePath, "utf8")));
const sql = createSqlAdapter(resolveDatabaseConfig());
const { importGroups, importActivities } = flattenTripImport(payload);
const existing = await sql`
  SELECT
    t.slug,
    a.id,
    a.item_key,
    TO_CHAR(a.start_date, 'YYYY-MM-DD') AS start_date,
    TO_CHAR(a.start_time, 'HH24:MI') AS start,
    TO_CHAR(a.end_date, 'YYYY-MM-DD') AS end_date,
    TO_CHAR(a.end_time, 'HH24:MI') AS end,
    a.type,
    a.title,
    a.detail,
    a.icon,
    a.display_end,
    a.reservation_contacts,
    branch_group.item_key AS branch_group_key,
    branch.item_key AS branch_key
  FROM trips t
  LEFT JOIN activities a ON a.trip_id = t.id
  LEFT JOIN schedule_branches branch ON branch.id = a.branch_id
  LEFT JOIN schedule_branch_groups branch_group ON branch_group.id = branch.group_id
  WHERE t.slug = ${payload.trip.slug}
  ORDER BY a.branch_id NULLS FIRST, a.sort_order
`;
const existingGroups = await sql`
  SELECT branch_group.item_key, branch.item_key AS branch_key
  FROM schedule_branch_groups branch_group
  JOIN trips trip ON trip.id = branch_group.trip_id
  LEFT JOIN schedule_branches branch ON branch.group_id = branch_group.id
  WHERE trip.slug = ${payload.trip.slug}
`;
const existingGroupKeys = new Set(existingGroups.map((row) => row.item_key));
const incomingGroupKeys = new Set(importGroups.map((group) => group.key));
const addedGroups = importGroups.filter((group) => !existingGroupKeys.has(group.key));
const removedGroups = [...existingGroupKeys].filter((key) => !incomingGroupKeys.has(key));

const existingItems = existing.filter((row) => row.id).map((row) => ({
  key: row.item_key || `unkeyed-${row.id}`,
  startDate: row.start_date,
  start: row.start,
  endDate: row.end_date,
  end: row.end,
  type: row.type,
  title: row.title,
  detail: row.detail,
  icon: row.icon,
  displayEnd: row.display_end,
  reservationContacts: row.reservation_contacts || [],
  branchGroupKey: row.branch_group_key,
  branchKey: row.branch_key,
}));
const before = new Map(existingItems.map((item) => [item.key, item]));
const after = new Map(importActivities.map((item) => [item.key, item]));
const added = importActivities.filter((item) => !before.has(item.key));
const removed = existingItems.filter((item) => !after.has(item.key));
const updated = importActivities.filter((item) => {
  const old = before.get(item.key);
  if (!old) return false;
  return ["startDate", "start", "endDate", "end", "type", "title", "detail", "icon", "displayEnd", "branchGroupKey", "branchKey"].some((field) => (old[field] ?? null) !== (item[field] ?? null))
    || JSON.stringify(old.reservationContacts || []) !== JSON.stringify(item.reservationContacts || []);
});

const affectedSuggestions = removed.length ? await sql`
  SELECT COUNT(*)::INTEGER AS count
  FROM suggestions s
  JOIN activities a ON a.id = s.activity_id
  JOIN trips t ON t.id = a.trip_id
  WHERE t.slug = ${payload.trip.slug} AND a.item_key = ANY(${removed.map((item) => item.key)}::text[])
` : [{ count: 0 }];

console.log(`${apply ? "APPLY" : "PREVIEW"}: ${payload.trip.title} (${payload.trip.slug})`);
console.log(`Trip: ${existing.length ? "update" : "create"} · ${payload.trip.startDate} → ${payload.trip.endDate}`);
console.log(`Schedule: ${importActivities.length} total · ${added.length} add · ${updated.length} update · ${removed.length} remove`);
const dayCounts = importActivities.reduce((counts, item) => counts.set(item.startDate, (counts.get(item.startDate) || 0) + 1), new Map());
for (const [date, count] of dayCounts) {
  console.log(`  ${date}: ${count} item(s)`);
}
console.log(`Branches: ${importGroups.length} point(s) · ${importGroups.reduce((count, group) => count + group.branches.length, 0)} option(s) · ${addedGroups.length} add · ${removedGroups.length} remove`);
console.log(`Sources: ${payload.sources.length} total`);
if (affectedSuggestions[0].count) console.log(`Notes preserved: ${affectedSuggestions[0].count} suggestion(s) will become trip-level notes because their schedule item is removed.`);
for (const item of added) console.log(`  + ${item.startDate} ${item.start} ${item.title}`);
for (const item of updated) console.log(`  ~ ${item.startDate} ${item.start} ${item.title}`);
for (const item of removed) console.log(`  - ${item.startDate} ${item.start} ${item.title}`);

if (!apply) {
  console.log(`No database changes made. Apply with: pnpm run trip:import ${fileArg} --apply`);
  await sql.end();
  process.exit(0);
}

await applyTripImport(sql, payload, {
  ownerEmail: process.env.AUTH_OWNER_EMAIL?.trim().toLowerCase() || "local-admin@localhost.invalid",
});
const { trip } = payload;

console.log("Import committed successfully.");

if (localAdmin.enabled) {
  console.log("Local admin import: production cache revalidation skipped.");
} else {
  const timestamp = Date.now();
  const signature = signRevalidation({ slug: trip.slug, timestamp }, process.env.AUTH_SECRET || "");
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  if (!appUrl) {
    console.warn("Warning: APP_URL is not configured. Cached reads expire within 5 minutes.");
  } else {
    try {
      const response = await fetch(`${appUrl}/api/internal/revalidate-trip`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trip-signature": signature,
        },
        body: JSON.stringify({ slug: trip.slug, timestamp }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      console.log("Production read cache invalidated.");
    } catch (error) {
      console.warn(`Warning: cache invalidation failed (${error.message}). Cached reads expire within 5 minutes.`);
    }
  }
}

await sql.end();
