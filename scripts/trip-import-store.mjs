import query, { empty } from "sql-template-tag";
import { executeQuery, insertActivity, replaceActivitySources } from "../lib/schedule-queries.mjs";

export function flattenTripImport(payload) {
  const importGroups = [
    ...(payload.startBranchGroup ? [{ ...payload.startBranchGroup, anchorKey: null }] : []),
    ...payload.schedule.filter((item) => item.branchGroup).map((item) => ({
      ...item.branchGroup,
      anchorKey: item.key,
    })),
  ];
  const importActivities = payload.schedule.flatMap((item) => [
    { ...item, branchGroup: undefined, branchGroupKey: null, branchKey: null },
    ...(item.branchGroup?.branches.flatMap((branch) => branch.schedule.map((branchItem) => ({
      ...branchItem,
      branchGroupKey: item.branchGroup.key,
      branchKey: branch.key,
    }))) || []),
  ]).concat(payload.startBranchGroup?.branches.flatMap((branch) => branch.schedule.map((branchItem) => ({
    ...branchItem,
    branchGroupKey: payload.startBranchGroup.key,
    branchKey: branch.key,
  }))) || []);
  return { importGroups, importActivities };
}

export async function applyTripImport(sql, payload, { createOnly = false } = {}) {
  const { importGroups, importActivities } = flattenTripImport(payload);
  const { trip, sources, schedule } = payload;
  const itemKeys = importActivities.map((item) => item.key);
  const groupKeys = importGroups.map((group) => group.key);
  const sourceNumbers = sources.map((source) => source.number);

  return sql.transaction((tx) => {
    const queries = [
      executeQuery(tx, query`
        INSERT INTO trips (slug, title, trip_date, end_date, timezone, location)
        VALUES (${trip.slug}, ${trip.title}, ${trip.startDate}, ${trip.endDate}, ${trip.timezone}, ${trip.location})
        ${createOnly ? empty : query`ON CONFLICT (slug) DO UPDATE SET
          title = EXCLUDED.title,
          trip_date = EXCLUDED.trip_date,
          end_date = EXCLUDED.end_date,
          timezone = EXCLUDED.timezone,
          location = EXCLUDED.location,
          updated_at = NOW()`}
      `),
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
      queries.push(executeQuery(tx, insertActivity(query`
        SELECT id AS trip_id, ${item.key}::TEXT AS item_key, NULL::BIGINT AS branch_id, ${index}::INTEGER AS sort_order
        FROM trips WHERE slug = ${trip.slug}`, item, { upsert: true })));
    }

    for (const group of importGroups) {
      if (group.anchorKey == null) {
        queries.push(tx`
          INSERT INTO schedule_branch_groups (trip_id, item_key, anchor_activity_id, title)
          SELECT trip_row.id, ${group.key}, NULL, ${group.title}
          FROM trips trip_row
          WHERE trip_row.slug = ${trip.slug}
          ON CONFLICT (trip_id, item_key) DO UPDATE SET
            anchor_activity_id = NULL,
            title = EXCLUDED.title,
            updated_at = NOW()
        `);
      } else {
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
      }
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
          queries.push(executeQuery(tx, insertActivity(query`
            SELECT trip_row.id AS trip_id, ${item.key}::TEXT AS item_key, branch.id AS branch_id, ${index}::INTEGER AS sort_order
            FROM trips trip_row
            JOIN schedule_branch_groups branch_group ON branch_group.trip_id = trip_row.id AND branch_group.item_key = ${group.key}
            JOIN schedule_branches branch ON branch.group_id = branch_group.id AND branch.item_key = ${branch.key}
            WHERE trip_row.slug = ${trip.slug}`, item, { upsert: true })));
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
    for (const item of importActivities) {
      const target = query`SELECT activity.id, activity.trip_id FROM activities activity
        JOIN trips trip ON trip.id = activity.trip_id WHERE trip.slug = ${trip.slug} AND activity.item_key = ${item.key}`;
      const sources = query`SELECT source.id, source.trip_id FROM sources source
        JOIN trips trip ON trip.id = source.trip_id WHERE trip.slug = ${trip.slug} AND source.source_number = ANY(${item.refs}::INTEGER[])`;
      queries.push(...replaceActivitySources(target, sources).map((item) => executeQuery(tx, item)));
    }

    queries.push(tx`
      DELETE FROM sources
      WHERE trip_id = (SELECT id FROM trips WHERE slug = ${trip.slug})
        AND source_number <> ALL(${sourceNumbers}::integer[])
    `);
    return queries;
  }, { isolationLevel: "Serializable" });

}
