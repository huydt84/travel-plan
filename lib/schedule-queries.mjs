import sql, { empty } from "sql-template-tag";

// Callers supply the target relation, including authorization/claim guards, and
// own the transaction. These fragments own only the schedule column mapping.
export function executeQuery(tx, query) {
  // Neon requires a TemplateStringsArray, including raw, unlike node-postgres.
  const strings = Object.assign([...query.strings], { raw: [...query.strings] });
  return tx(strings, ...query.values);
}

export function insertActivity(target, input, { upsert = false } = {}) {
  return sql`
    INSERT INTO activities (trip_id, item_key, branch_id, sort_order, start_date, start_time, end_date, end_time, display_end, type, icon, title, detail, reservation_contacts)
    SELECT target.trip_id, target.item_key, target.branch_id, target.sort_order,
      ${input.startDate}::DATE, ${input.start}::TIME, ${input.endDate}::DATE, ${input.end}::TIME,
      ${input.displayEnd ?? null}, ${input.type}, ${input.icon}, ${input.title}, ${input.detail}, ${JSON.stringify(input.reservationContacts ?? [])}::JSONB
    FROM (${target}) target
    ${upsert ? sql`ON CONFLICT (trip_id, item_key) DO UPDATE SET
      branch_id = EXCLUDED.branch_id, sort_order = EXCLUDED.sort_order,
      start_date = EXCLUDED.start_date, start_time = EXCLUDED.start_time,
      end_date = EXCLUDED.end_date, end_time = EXCLUDED.end_time,
      display_end = EXCLUDED.display_end, type = EXCLUDED.type, icon = EXCLUDED.icon,
      title = EXCLUDED.title, detail = EXCLUDED.detail, reservation_contacts = EXCLUDED.reservation_contacts` : empty}
    RETURNING id
  `;
}

export function updateActivity(target, input) {
  return sql`
    UPDATE activities activity SET
      start_date = COALESCE(${input.startDate ?? null}::DATE, activity.start_date),
      start_time = COALESCE(${input.start ?? null}::TIME, activity.start_time),
      end_date = COALESCE(${input.endDate ?? null}::DATE, activity.end_date),
      end_time = COALESCE(${input.end ?? null}::TIME, activity.end_time),
      display_end = CASE WHEN ${input.displayEnd !== undefined} THEN ${input.displayEnd ?? null} ELSE activity.display_end END,
      type = COALESCE(${input.type ?? null}, activity.type),
      icon = COALESCE(${input.icon ?? null}, activity.icon),
      title = COALESCE(${input.title ?? null}, activity.title),
      detail = COALESCE(${input.detail ?? null}, activity.detail),
      reservation_contacts = CASE WHEN ${input.reservationContacts !== undefined}
        THEN ${JSON.stringify(input.reservationContacts ?? [])}::JSONB ELSE activity.reservation_contacts END
    WHERE activity.id IN (${target}) RETURNING activity.id
  `;
}

export function replaceActivitySources(target, sources) {
  return [
    sql`DELETE FROM activity_sources WHERE activity_id IN (SELECT id FROM (${target}) target)`,
    sql`INSERT INTO activity_sources (activity_id, source_id)
      SELECT target.id, source.id FROM (${target}) target
      JOIN (${sources}) source ON source.trip_id = target.trip_id`,
  ];
}
