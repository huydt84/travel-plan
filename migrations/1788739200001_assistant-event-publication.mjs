import { migrationSql } from "./support.mjs";
export const down = false;
export async function up(pgm) {
  const sql = migrationSql(pgm);
  // The turn lock serializes event writers with cancellation and final publication.
  // Separate statements after the lock see the newest committed sequence.
  await sql`CREATE OR REPLACE FUNCTION append_assistant_event(run UUID, event JSONB)
    RETURNS INTEGER LANGUAGE plpgsql AS $$
    DECLARE state TEXT; terminal BOOLEAN; next_seq INTEGER;
    BEGIN
      SELECT status INTO state FROM assistant_turns WHERE id=run FOR UPDATE;
      IF state IS NULL THEN RETURN NULL; END IF;
      terminal := event->>'type' IN ('completed','failed','cancelled');
      IF terminal THEN
        IF state='running' THEN RETURN NULL; END IF;
        SELECT seq INTO next_seq FROM assistant_events WHERE turn_id=run
          AND payload->>'type' IN ('completed','failed','cancelled') LIMIT 1;
        IF next_seq IS NOT NULL THEN RETURN next_seq; END IF;
      ELSIF state <> 'running' THEN RETURN NULL;
      END IF;
      SELECT COALESCE(MAX(seq),0)+1 INTO next_seq FROM assistant_events WHERE turn_id=run;
      INSERT INTO assistant_events(turn_id,seq,payload) VALUES(run,next_seq,event);
      IF event->>'type'='answer-delta' THEN
        UPDATE assistant_turns SET output_text=CASE WHEN COALESCE((event->>'reset')::BOOLEAN,FALSE)
          THEN event->>'text' ELSE COALESCE(output_text,'') || (event->>'text') END WHERE id=run;
      ELSIF event->>'type'='evidence' THEN
        UPDATE assistant_turns SET citations=event->'citations' WHERE id=run;
      END IF;
      RETURN next_seq;
    END; $$`;
}
