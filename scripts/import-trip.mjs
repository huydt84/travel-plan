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
  console.error("Usage: npm run trip:import -- <trip.json> [--apply]");
  process.exit(1);
}
const localAdmin = resolveLocalAdminMode();

const filePath = resolve(fileArg);
const payload = normalizeTripImport(JSON.parse(await readFile(filePath, "utf8")));
const sql = createSqlAdapter(resolveDatabaseConfig());
const importGroups = payload.schedule.filter((item) => item.branchGroup).map((item) => ({
  ...item.branchGroup,
  anchorKey: item.key,
}));
const importActivities = payload.schedule.flatMap((item) => [
  { ...item, branchGroup: undefined, branchGroupKey: null, branchKey: null },
  ...(item.branchGroup?.branches.flatMap((branch) => branch.schedule.map((branchItem) => ({
    ...branchItem,
    branchGroupKey: item.branchGroup.key,
    branchKey: branch.key,
  }))) || []),
]);
const existing = await sql`
  SELECT
    t.slug,
    a.id,
    a.item_key,
    TO_CHAR(a.start_time, 'HH24:MI') AS start,
    TO_CHAR(a.end_time, 'HH24:MI') AS end,
    a.type,
    a.title,
    a.detail,
    a.icon,
    a.display_end,
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
  start: row.start,
  end: row.end,
  type: row.type,
  title: row.title,
  detail: row.detail,
  icon: row.icon,
  displayEnd: row.display_end,
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
  return ["start", "end", "type", "title", "detail", "icon", "displayEnd", "branchGroupKey", "branchKey"].some((field) => (old[field] ?? null) !== (item[field] ?? null));
});

const affectedSuggestions = removed.length ? await sql`
  SELECT COUNT(*)::INTEGER AS count
  FROM suggestions s
  JOIN activities a ON a.id = s.activity_id
  JOIN trips t ON t.id = a.trip_id
  WHERE t.slug = ${payload.trip.slug} AND a.item_key = ANY(${removed.map((item) => item.key)}::text[])
` : [{ count: 0 }];

console.log(`${apply ? "APPLY" : "PREVIEW"}: ${payload.trip.title} (${payload.trip.slug})`);
console.log(`Trip: ${existing.length ? "update" : "create"}`);
console.log(`Schedule: ${importActivities.length} total · ${added.length} add · ${updated.length} update · ${removed.length} remove`);
console.log(`Branches: ${importGroups.length} point(s) · ${importGroups.reduce((count, group) => count + group.branches.length, 0)} option(s) · ${addedGroups.length} add · ${removedGroups.length} remove`);
console.log(`Sources: ${payload.sources.length} total`);
if (affectedSuggestions[0].count) console.log(`Notes preserved: ${affectedSuggestions[0].count} suggestion(s) will become trip-level notes because their schedule item is removed.`);
for (const item of added) console.log(`  + ${item.start} ${item.title}`);
for (const item of updated) console.log(`  ~ ${item.start} ${item.title}`);
for (const item of removed) console.log(`  - ${item.start} ${item.title}`);

if (!apply) {
  console.log(`No database changes made. Apply with: npm run trip:import -- ${fileArg} --apply`);
  await sql.end();
  process.exit(0);
}

const { trip, sources, schedule } = payload;
const itemKeys = importActivities.map((item) => item.key);
const groupKeys = importGroups.map((group) => group.key);
const sourceNumbers = sources.map((source) => source.number);

await sql.transaction((tx) => {
  const queries = [
    tx`
      INSERT INTO trips (slug, title, trip_date, timezone, location)
      VALUES (${trip.slug}, ${trip.title}, ${trip.date}, ${trip.timezone}, ${trip.location})
      ON CONFLICT (slug) DO UPDATE SET
        title = EXCLUDED.title,
        trip_date = EXCLUDED.trip_date,
        timezone = EXCLUDED.timezone,
        location = EXCLUDED.location,
        updated_at = NOW()
    `,
  ];

  for (const source of sources) {
    queries.push(tx`
      INSERT INTO sources (trip_id, source_number, title, host, url)
      SELECT id, ${source.number}, ${source.title}, ${source.host}, ${source.url}
      FROM trips WHERE slug = ${trip.slug}
      ON CONFLICT (trip_id, source_number) DO UPDATE SET
        title = EXCLUDED.title,
        host = EXCLUDED.host,
        url = EXCLUDED.url
    `);
  }

  queries.push(tx`
    UPDATE activities
    SET sort_order = sort_order + 1000000
    WHERE trip_id = (SELECT id FROM trips WHERE slug = ${trip.slug})
  `);

  for (const [index, item] of schedule.entries()) {
    queries.push(tx`
      INSERT INTO activities (trip_id, item_key, branch_id, sort_order, start_time, end_time, display_end, type, icon, title, detail)
      SELECT id, ${item.key}, NULL, ${index}, ${item.start}, ${item.end}, ${item.displayEnd}, ${item.type}, ${item.icon}, ${item.title}, ${item.detail}
      FROM trips WHERE slug = ${trip.slug}
      ON CONFLICT (trip_id, item_key) DO UPDATE SET
        branch_id = NULL,
        sort_order = EXCLUDED.sort_order,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        display_end = EXCLUDED.display_end,
        type = EXCLUDED.type,
        icon = EXCLUDED.icon,
        title = EXCLUDED.title,
        detail = EXCLUDED.detail
    `);
  }

  for (const group of importGroups) {
    queries.push(tx`
      INSERT INTO schedule_branch_groups (trip_id, item_key, anchor_activity_id, title)
      SELECT trip_row.id, ${group.key}, activity.id, ${group.title}
      FROM trips trip_row
      JOIN activities activity ON activity.trip_id = trip_row.id AND activity.item_key = ${group.anchorKey}
      WHERE trip_row.slug = ${trip.slug}
      ON CONFLICT (trip_id, item_key) DO UPDATE SET
        anchor_activity_id = EXCLUDED.anchor_activity_id,
        title = EXCLUDED.title,
        updated_at = NOW()
    `);
    queries.push(tx`
      UPDATE schedule_branches branch
      SET is_default = FALSE
      FROM schedule_branch_groups branch_group, trips trip_row
      WHERE branch.group_id = branch_group.id
        AND branch_group.trip_id = trip_row.id
        AND trip_row.slug = ${trip.slug}
        AND branch_group.item_key = ${group.key}
        AND branch.is_default
    `);
    for (const [branchIndex, branch] of group.branches.entries()) {
      queries.push(tx`
        INSERT INTO schedule_branches (trip_id, group_id, item_key, label, condition_text, sort_order, is_default)
        SELECT trip_row.id, branch_group.id, ${branch.key}, ${branch.label}, ${branch.condition}, ${branchIndex}, ${branch.key === group.defaultBranchKey}
        FROM trips trip_row
        JOIN schedule_branch_groups branch_group ON branch_group.trip_id = trip_row.id AND branch_group.item_key = ${group.key}
        WHERE trip_row.slug = ${trip.slug}
        ON CONFLICT (group_id, item_key) DO UPDATE SET
          label = EXCLUDED.label,
          condition_text = EXCLUDED.condition_text,
          sort_order = EXCLUDED.sort_order,
          is_default = EXCLUDED.is_default,
          updated_at = NOW()
      `);
    }
    const branchKeys = group.branches.map((branch) => branch.key);
    queries.push(tx`
      INSERT INTO schedule_branch_selections (group_id, trip_id, branch_id, selected_by_email)
      SELECT branch_group.id, trip_row.id, branch.id, 'trip-import'
      FROM trips trip_row
      JOIN schedule_branch_groups branch_group ON branch_group.trip_id = trip_row.id AND branch_group.item_key = ${group.key}
      JOIN schedule_branches branch ON branch.group_id = branch_group.id AND branch.item_key = ${group.defaultBranchKey}
      WHERE trip_row.slug = ${trip.slug}
      ON CONFLICT (group_id) DO NOTHING
    `);
    queries.push(tx`
      UPDATE schedule_branch_selections selection
      SET branch_id = default_branch.id, selected_at = NOW(), selected_by_email = 'trip-import'
      FROM schedule_branch_groups branch_group
      JOIN schedule_branches default_branch ON default_branch.group_id = branch_group.id AND default_branch.item_key = ${group.defaultBranchKey}
      JOIN trips trip_row ON trip_row.id = branch_group.trip_id
      WHERE selection.group_id = branch_group.id
        AND trip_row.slug = ${trip.slug}
        AND branch_group.item_key = ${group.key}
        AND NOT EXISTS (
          SELECT 1 FROM schedule_branches selected_branch
          WHERE selected_branch.id = selection.branch_id AND selected_branch.item_key = ANY(${branchKeys}::TEXT[])
        )
    `);
  }

  for (const group of importGroups) {
    for (const branch of group.branches) {
      for (const [index, item] of branch.schedule.entries()) {
        queries.push(tx`
          INSERT INTO activities (trip_id, item_key, branch_id, sort_order, start_time, end_time, display_end, type, icon, title, detail)
          SELECT trip_row.id, ${item.key}, branch.id, ${index}, ${item.start}, ${item.end}, ${item.displayEnd}, ${item.type}, ${item.icon}, ${item.title}, ${item.detail}
          FROM trips trip_row
          JOIN schedule_branch_groups branch_group ON branch_group.trip_id = trip_row.id AND branch_group.item_key = ${group.key}
          JOIN schedule_branches branch ON branch.group_id = branch_group.id AND branch.item_key = ${branch.key}
          WHERE trip_row.slug = ${trip.slug}
          ON CONFLICT (trip_id, item_key) DO UPDATE SET
            branch_id = EXCLUDED.branch_id,
            sort_order = EXCLUDED.sort_order,
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            display_end = EXCLUDED.display_end,
            type = EXCLUDED.type,
            icon = EXCLUDED.icon,
            title = EXCLUDED.title,
            detail = EXCLUDED.detail
        `);
      }
    }
  }

  queries.push(tx`
    DELETE FROM activities
    WHERE trip_id = (SELECT id FROM trips WHERE slug = ${trip.slug})
      AND (item_key IS NULL OR item_key <> ALL(${itemKeys}::text[]))
  `);
  for (const group of importGroups) {
    const branchKeys = group.branches.map((branch) => branch.key);
    queries.push(tx`
      DELETE FROM schedule_branches branch
      USING schedule_branch_groups branch_group, trips trip_row
      WHERE branch.group_id = branch_group.id
        AND branch_group.trip_id = trip_row.id
        AND trip_row.slug = ${trip.slug}
        AND branch_group.item_key = ${group.key}
        AND branch.item_key <> ALL(${branchKeys}::TEXT[])
    `);
  }
  queries.push(tx`
    DELETE FROM schedule_branch_groups branch_group
    USING trips trip_row
    WHERE branch_group.trip_id = trip_row.id
      AND trip_row.slug = ${trip.slug}
      AND branch_group.item_key <> ALL(${groupKeys}::TEXT[])
  `);
  queries.push(tx`
    DELETE FROM activity_sources activity_source
    USING activities activity, trips trip_row
    WHERE activity_source.activity_id = activity.id
      AND activity.trip_id = trip_row.id
      AND trip_row.slug = ${trip.slug}
  `);

  for (const item of importActivities) {
    for (const reference of item.refs) {
      queries.push(tx`
        INSERT INTO activity_sources (activity_id, source_id)
        SELECT activity.id, source.id
        FROM activities activity
        JOIN trips trip_row ON trip_row.id = activity.trip_id
        JOIN sources source ON source.trip_id = trip_row.id AND source.source_number = ${reference}
        WHERE trip_row.slug = ${trip.slug} AND activity.item_key = ${item.key}
      `);
    }
  }

  queries.push(tx`
    DELETE FROM sources
    WHERE trip_id = (SELECT id FROM trips WHERE slug = ${trip.slug})
      AND source_number <> ALL(${sourceNumbers}::integer[])
  `);
  return queries;
}, { isolationLevel: "Serializable" });

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
