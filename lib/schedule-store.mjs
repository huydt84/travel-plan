import query from "sql-template-tag";
import { executeQuery, insertActivity, updateActivity, replaceActivitySources } from "./schedule-queries.mjs";

// null sourceIds preserves links; [] clears them. Validation belongs to callers.
export async function saveScheduleRecord(sql, { tripId, activityId = null, itemKey = null, input, sourceIds = null }) {
  const target = query`SELECT id, trip_id FROM activities WHERE trip_id = ${tripId}
    AND (id = ${activityId}::BIGINT OR (${activityId}::BIGINT IS NULL AND item_key = ${itemKey}))`;
  const results = await sql.transaction((tx) => {
    const write = activityId == null
      ? insertActivity(query`SELECT ${tripId}::BIGINT AS trip_id, ${itemKey}::TEXT AS item_key,
          ${input.branchId ?? null}::BIGINT AS branch_id, COALESCE(MAX(sort_order), -1) + 1 AS sort_order
          FROM activities WHERE trip_id = ${tripId}
            AND branch_id IS NOT DISTINCT FROM ${input.branchId ?? null}::BIGINT`, input)
      : updateActivity(query`SELECT id FROM (${target}) target`, input);
    const queries = [write];
    if (sourceIds !== null) queries.push(...replaceActivitySources(target,
      query`SELECT source_id AS id, ${tripId}::BIGINT AS trip_id FROM UNNEST(${sourceIds}::BIGINT[]) AS source_id`));
    return queries.map((item) => executeQuery(tx, item));
  }, { isolationLevel: "Serializable" });
  return results[0][0]?.id ?? null;
}
