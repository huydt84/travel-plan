// Fixture trips no longer cascade-delete their conversations.
export async function cleanupAssistantTrips(sql, tripIds) {
  const ids = tripIds.map(String);
  await sql`DELETE FROM assistant_conversations c WHERE c.trip_id=ANY(${ids}::BIGINT[])
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.pins) ref WHERE ref->>'kind'='trip' AND ref->>'id'=ANY(${ids}::TEXT[]))
    OR EXISTS(SELECT 1 FROM assistant_turns t, jsonb_array_elements(t.mentions || t.pinned_context) ref
      WHERE t.conversation_id=c.id AND ref->>'kind'='trip' AND ref->>'id'=ANY(${ids}::TEXT[]))`;
}
