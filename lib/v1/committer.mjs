import { randomUUID } from "node:crypto";
import { AssistantFault } from "./errors.mjs";

export async function commitStoredChangeSet({ store, changeSet, actorEmail }) {
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
      queryBuilders.push((tx) => tx`
        INSERT INTO activities (trip_id, item_key, branch_id, sort_order, start_time, end_time, display_end, type, icon, title, detail)
        SELECT ${changeSet.tripId}, ${operation.itemKey}, ${operation.branchId}::BIGINT,
               COALESCE((SELECT MAX(sort_order) + 1 FROM activities WHERE trip_id = ${changeSet.tripId} AND branch_id IS NOT DISTINCT FROM ${operation.branchId}::BIGINT), 0),
               ${operation.value.start}, ${operation.value.end}, ${operation.value.displayEnd}, ${operation.value.type},
               ${operation.value.icon}, ${operation.value.title}, ${operation.value.detail}
        WHERE EXISTS (SELECT 1 FROM assistant_change_sets WHERE id = ${changeSet.id}::UUID AND status = 'applying' AND commit_id = ${commitId}::UUID)
          AND (${operation.branchId}::BIGINT IS NULL OR EXISTS (
            SELECT 1 FROM schedule_branches WHERE id = ${operation.branchId}::BIGINT AND trip_id = ${changeSet.tripId}
          ))
      `);
    }
    if (operation.kind === "activity.update") {
      const set = operation.set || {};
      queryBuilders.push((tx) => tx`
        UPDATE activities activity
        SET start_time = CASE WHEN ${Object.hasOwn(set, "start")} THEN ${set.start ?? null}::TIME ELSE activity.start_time END,
            end_time = CASE WHEN ${Object.hasOwn(set, "end")} THEN ${set.end ?? null}::TIME ELSE activity.end_time END,
            display_end = CASE WHEN ${Object.hasOwn(set, "displayEnd")} THEN ${set.displayEnd ?? null} ELSE activity.display_end END,
            type = CASE WHEN ${Object.hasOwn(set, "type")} THEN ${set.type ?? null} ELSE activity.type END,
            icon = CASE WHEN ${Object.hasOwn(set, "icon")} THEN ${set.icon ?? null} ELSE activity.icon END,
            title = CASE WHEN ${Object.hasOwn(set, "title")} THEN ${set.title ?? null} ELSE activity.title END,
            detail = CASE WHEN ${Object.hasOwn(set, "detail")} THEN ${set.detail ?? null} ELSE activity.detail END
        WHERE activity.trip_id = ${changeSet.tripId} AND activity.item_key = ${operation.itemKey}
          AND EXISTS (SELECT 1 FROM assistant_change_sets WHERE id = ${changeSet.id}::UUID AND status = 'applying' AND commit_id = ${commitId}::UUID)
      `);
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
    queryBuilders.push((tx) => tx`
      DELETE FROM activity_sources link
      USING activities activity
      WHERE link.activity_id = activity.id
        AND activity.trip_id = ${changeSet.tripId}
        AND activity.item_key = ${operation.itemKey}
        AND EXISTS (SELECT 1 FROM assistant_change_sets WHERE id = ${changeSet.id}::UUID AND status = 'applying' AND commit_id = ${commitId}::UUID)
    `);
    for (const sourceNumber of refs) {
      queryBuilders.push((tx) => tx`
        INSERT INTO activity_sources (activity_id, source_id)
        SELECT activity.id, source.id
        FROM activities activity
        JOIN sources source ON source.trip_id = activity.trip_id AND source.source_number = ${sourceNumber}
        WHERE activity.trip_id = ${changeSet.tripId} AND activity.item_key = ${operation.itemKey}
          AND EXISTS (SELECT 1 FROM assistant_change_sets WHERE id = ${changeSet.id}::UUID AND status = 'applying' AND commit_id = ${commitId}::UUID)
      `);
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
             ROW_NUMBER() OVER (PARTITION BY activity.branch_id ORDER BY activity.start_time, activity.end_time, activity.item_key, activity.id) - 1 AS next_order
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
