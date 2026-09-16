import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`CREATE OR REPLACE FUNCTION execute_assistant_action_with_membership(p_action_id UUID, actor TEXT, approved_digest TEXT)
    RETURNS JSONB LANGUAGE plpgsql AS $$
    DECLARE v_receipt JSONB;
    BEGIN
      v_receipt := execute_assistant_action(p_action_id,actor,approved_digest);
      IF v_receipt ? 'error' THEN RETURN v_receipt; END IF;
      INSERT INTO trip_participants(trip_id,user_email,role,added_by_email,joined_at,last_participated_at)
        SELECT DISTINCT trip.id,LOWER(actor),'leader',LOWER(actor),NOW(),NOW()
        FROM jsonb_array_elements(v_receipt->'resources') resource JOIN trips trip ON trip.id=(resource->>'tripId')::BIGINT
        WHERE NOT EXISTS(SELECT 1 FROM trip_participants participant WHERE participant.trip_id=trip.id AND participant.role='leader')
        ON CONFLICT(trip_id,user_email) DO NOTHING;
      INSERT INTO trip_audit_events(trip_id,trip_slug,trip_title,actor_email,actor_name,actor_role,source,action,entity_type,after_value)
        SELECT DISTINCT trip.id,trip.slug,trip.title,LOWER(actor),COALESCE(user_row.display_name,user_row.name,actor),'admin',
          'assistant','assistant.batch_applied','assistant_batch',assistant_action.operations
        FROM assistant_actions assistant_action
        CROSS JOIN jsonb_array_elements(v_receipt->'resources') resource
        JOIN trips trip ON trip.id=(resource->>'tripId')::BIGINT
        LEFT JOIN users user_row ON user_row.email=LOWER(actor)
        WHERE assistant_action.id=p_action_id;
      RETURN v_receipt;
    END $$`;
}
