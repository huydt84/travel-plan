import query from "sql-template-tag";
import { executeQuery, insertActivity, updateActivity, replaceActivitySources } from "../schedule-queries.mjs";
import { randomUUID } from "node:crypto";
import { AssistantFault } from "./errors.mjs";

export async function commitStoredChangeSet(input) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await commitOnce(input); }
    catch (error) {
      if (!["40001", "40P01"].includes(error.code) || attempt >= 2) throw error;
      input = { ...input, changeSet: await input.store.getChangeSet(input.changeSet.id, input.actorEmail) };
    }
  }
}

async function commitOnce({ store, changeSet, actorEmail }) {
  if (changeSet.status === "applied" && changeSet.receipt) return changeSet.receipt;
  if (changeSet.status !== "staged") {
    throw new AssistantFault("PROPOSAL_ALREADY_RESOLVED", "Đề xuất không còn ở trạng thái chờ áp dụng", { status: 409 });
  }
  if (new Date(changeSet.expiresAt).getTime() <= Date.now()) {
    await store.sql`
      UPDATE assistant_change_sets SET status = 'expired'
      WHERE id = ${changeSet.id}::UUID AND status = 'staged'
    `;
    throw new AssistantFault("PROPOSAL_EXPIRED", "Đề xuất đã hết hạn; hãy tạo lại từ lịch mới nhất", { status: 410 });
  }

  const commitId = randomUUID();
  const claim = query`EXISTS (SELECT 1 FROM assistant_change_sets WHERE id = ${changeSet.id}::UUID AND status = 'applying' AND commit_id = ${commitId}::UUID)`;
  const target = (itemKey) => query`SELECT id, trip_id FROM activities WHERE trip_id = ${changeSet.tripId} AND item_key = ${itemKey} AND ${claim}`;
  const queryBuilders = [];
  queryBuilders.push((tx) => tx`
    SELECT trip.id, trip.plan_revision
    FROM trips trip
    WHERE trip.id = ${changeSet.tripId}
    FOR UPDATE
  `);
  queryBuilders.push((tx) => tx`
    UPDATE assistant_change_sets change_set
    SET status = 'applying', commit_id = ${commitId}::UUID
    FROM assistant_turns turn
    JOIN assistant_conversations conversation ON conversation.id = turn.conversation_id
    CROSS JOIN trips trip
    WHERE change_set.id = ${changeSet.id}::UUID
      AND change_set.turn_id = turn.id
      AND turn.status = 'completed'
      AND trip.id = change_set.trip_id
      AND conversation.owner_email = ${actorEmail}
      AND change_set.status = 'staged'
      AND change_set.expires_at > NOW()
      AND trip.plan_revision = change_set.base_revision
    RETURNING change_set.id
  `);

  for (const operation of changeSet.operations) {
    if (operation.kind === "source.add") {
      queryBuilders.push((tx) => tx`
        INSERT INTO sources (trip_id, source_number, title, host, url)
        SELECT ${changeSet.tripId}, ${operation.sourceNumber}, ${operation.title}, ${operation.host}, ${operation.url}
        WHERE EXISTS (SELECT 1 FROM assistant_change_sets WHERE id = ${changeSet.id}::UUID AND status = 'applying' AND commit_id = ${commitId}::UUID)
      `);
    }
  }

  for (const operation of changeSet.operations) {
    if (operation.kind === "activity.add") {
      queryBuilders.push((tx) => executeQuery(tx, insertActivity(query`
        SELECT ${changeSet.tripId}::BIGINT AS trip_id, ${operation.itemKey}::TEXT AS item_key,
          ${operation.branchId}::BIGINT AS branch_id,
          COALESCE((SELECT MAX(sort_order) + 1 FROM activities WHERE trip_id = ${changeSet.tripId}
            AND branch_id IS NOT DISTINCT FROM ${operation.branchId}::BIGINT), 0) AS sort_order
        WHERE ${claim} AND (${operation.branchId}::BIGINT IS NULL OR EXISTS (
          SELECT 1 FROM schedule_branches WHERE id = ${operation.branchId}::BIGINT AND trip_id = ${changeSet.tripId}
        ))`, operation.value)));
    }
    if (operation.kind === "activity.update") {
      queryBuilders.push((tx) => executeQuery(tx, updateActivity(
        query`SELECT id FROM (${target(operation.itemKey)}) target`, operation.set || {})));
    }
    if (operation.kind === "activity.remove") {
      queryBuilders.push((tx) => tx`
        DELETE FROM activities activity
        WHERE activity.trip_id = ${changeSet.tripId} AND activity.item_key = ${operation.itemKey}
          AND EXISTS (SELECT 1 FROM assistant_change_sets WHERE id = ${changeSet.id}::UUID AND status = 'applying' AND commit_id = ${commitId}::UUID)
      `);
    }
  }

  for (const operation of changeSet.operations) {
    const refs = operation.kind === "activity.setSources"
      ? operation.refs
      : operation.kind === "activity.add"
        ? operation.value.refs
        : operation.kind === "activity.update" && Object.hasOwn(operation.set || {}, "refs")
          ? operation.set.refs
          : null;
    if (!refs) continue;
    const sources = query`SELECT id, trip_id FROM sources WHERE trip_id = ${changeSet.tripId} AND source_number = ANY(${refs}::INTEGER[])`;
    for (const statement of replaceActivitySources(target(operation.itemKey), sources)) {
      queryBuilders.push((tx) => executeQuery(tx, statement));
    }
  }

  queryBuilders.push((tx) => tx`
    UPDATE activities activity
    SET sort_order = activity.sort_order + 1000000
    WHERE activity.trip_id = ${changeSet.tripId}
      AND EXISTS (SELECT 1 FROM assistant_change_sets WHERE id = ${changeSet.id}::UUID AND status = 'applying' AND commit_id = ${commitId}::UUID)
  `);
  queryBuilders.push((tx) => tx`
    WITH ranked AS (
      SELECT activity.id,
             ROW_NUMBER() OVER (PARTITION BY activity.branch_id ORDER BY activity.start_date, activity.start_time, activity.end_date, activity.end_time, activity.item_key, activity.id) - 1 AS next_order
      FROM activities activity
      WHERE activity.trip_id = ${changeSet.tripId}
    )
    UPDATE activities activity
    SET sort_order = ranked.next_order
    FROM ranked
    WHERE activity.id = ranked.id
      AND EXISTS (SELECT 1 FROM assistant_change_sets WHERE id = ${changeSet.id}::UUID AND status = 'applying' AND commit_id = ${commitId}::UUID)
  `);
  queryBuilders.push((tx) => tx`
    UPDATE assistant_change_sets change_set
    SET status = 'applied', applied_at = NOW(),
        receipt = jsonb_build_object(
          'proposalId', change_set.id,
          'tripSlug', trip.slug,
          'fromRevision', change_set.base_revision,
          'toRevision', trip.plan_revision,
          'appliedAt', NOW(),
          'summary', change_set.preview->>'summary',
          'commitId', ${commitId}::UUID
        )
    FROM trips trip
    WHERE change_set.id = ${changeSet.id}::UUID
      AND change_set.status = 'applying'
      AND change_set.commit_id = ${commitId}::UUID
      AND trip.id = change_set.trip_id
    RETURNING change_set.receipt
  `);

  const results = await store.sql.transaction(
    (tx) => queryBuilders.map((build) => build(tx)),
    { isolationLevel: "Serializable" },
  );
  if (!results[1]?.length) {
    const latest = await store.getChangeSet(changeSet.id, actorEmail);
    if (latest.status === "applied" && latest.receipt) return latest.receipt;
    if (latest.turnStatus && latest.turnStatus !== 'completed') {
      throw new AssistantFault('PROPOSAL_INCOMPLETE', 'Đề xuất thuộc yêu cầu chưa hoàn tất', { status: 409 });
    }
    if (new Date(latest.expiresAt).getTime() <= Date.now()) {
      throw new AssistantFault('PROPOSAL_EXPIRED', 'Đề xuất đã hết hạn', { status: 410 });
    }
    await store.sql`
      UPDATE assistant_change_sets SET status = 'conflicted'
      WHERE id = ${changeSet.id}::UUID AND status = 'staged'
    `;
    throw new AssistantFault("PLAN_CONFLICT", "Lịch đã thay đổi sau khi đề xuất được tạo; hãy tạo lại đề xuất", { status: 409 });
  }
  const latest = await store.getChangeSet(changeSet.id, actorEmail);
  if (!latest.receipt) throw new AssistantFault("COMMIT_FAILED", "Không thể hoàn tất thay đổi", { status: 503, retryable: true });
  return latest.receipt;
}
