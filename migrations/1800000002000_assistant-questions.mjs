import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`ALTER TABLE assistant_turns DROP CONSTRAINT IF EXISTS assistant_turns_status_check`;
  await sql`ALTER TABLE assistant_turns ADD CONSTRAINT assistant_turns_status_check
    CHECK(status IN ('running','awaiting_approval','awaiting_input','completed','failed'))`;
  await sql`DROP INDEX IF EXISTS assistant_turns_one_running_idx`;
  await sql`CREATE UNIQUE INDEX assistant_turns_one_running_idx ON assistant_turns(conversation_id)
    WHERE status IN ('running','awaiting_approval','awaiting_input')`;

  await sql`CREATE TABLE IF NOT EXISTS assistant_questions (
    id UUID PRIMARY KEY,
    turn_id UUID NOT NULL REFERENCES assistant_turns(id) ON DELETE CASCADE,
    segment INTEGER NOT NULL,
    call_id TEXT NOT NULL,
    questions JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','answered','cancelled')),
    submission_id UUID,
    answers JSONB,
    answered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(turn_id,segment),
    CHECK((status='answered')=(submission_id IS NOT NULL AND answers IS NOT NULL AND answered_at IS NOT NULL))
  )`;

  await sql`CREATE OR REPLACE FUNCTION assistant_question_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
    IF (to_jsonb(NEW)-ARRAY['status','submission_id','answers','answered_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','submission_id','answers','answered_at']) THEN
      RAISE EXCEPTION 'Immutable assistant question';
    END IF;
    RETURN NEW;
  END $$`;
  await sql`DROP TRIGGER IF EXISTS assistant_question_immutable_trigger ON assistant_questions`;
  await sql`CREATE TRIGGER assistant_question_immutable_trigger BEFORE UPDATE ON assistant_questions
    FOR EACH ROW EXECUTE FUNCTION assistant_question_immutable()`;

  await sql`CREATE OR REPLACE FUNCTION assistant_cancel_actions() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.status='failed' THEN
        UPDATE assistant_actions SET status='cancelled',decided_at=NOW() WHERE turn_id=NEW.id AND status='pending';
        UPDATE assistant_questions SET status='cancelled' WHERE turn_id=NEW.id AND status='pending';
      END IF;
      RETURN NEW;
    END $$`;

  await sql`CREATE OR REPLACE FUNCTION answer_assistant_question(question_id UUID, actor TEXT, submission UUID, answer_values JSONB)
    RETURNS JSONB LANGUAGE plpgsql AS $$
    DECLARE q assistant_questions%ROWTYPE; t assistant_turns%ROWTYPE; item JSONB; definition JSONB; updated assistant_questions%ROWTYPE;
    BEGIN
      SELECT at.* INTO t FROM assistant_questions aq JOIN assistant_turns at ON at.id=aq.turn_id
        JOIN assistant_conversations c ON c.id=at.conversation_id
        WHERE aq.id=question_id AND c.owner_email=actor FOR UPDATE OF at;
      IF NOT FOUND THEN RETURN jsonb_build_object('error','QUESTION_NOT_FOUND'); END IF;
      SELECT * INTO q FROM assistant_questions WHERE id=question_id FOR UPDATE;
      IF q.status='answered' AND q.submission_id=submission AND q.answers=answer_values THEN
        RETURN jsonb_build_object('question',to_jsonb(q),'replayed',TRUE);
      END IF;
      IF q.status<>'pending' OR t.status<>'awaiting_input' OR q.segment<>t.segment THEN
        RETURN jsonb_build_object('error','QUESTION_RESOLVED');
      END IF;
      IF jsonb_typeof(answer_values)<>'array' OR jsonb_array_length(answer_values)<>jsonb_array_length(q.questions) THEN
        RETURN jsonb_build_object('error','QUESTION_ANSWER_INVALID');
      END IF;
      FOR item IN SELECT value FROM jsonb_array_elements(answer_values) LOOP
        SELECT value INTO definition FROM jsonb_array_elements(q.questions) WHERE value->>'id'=item->>'questionId';
        IF definition IS NULL OR NOT ((item ? 'text' AND length(btrim(item->>'text')) BETWEEN 1 AND 1000)
          OR (item ? 'optionId' AND EXISTS(SELECT 1 FROM jsonb_array_elements(definition->'options') option WHERE option->>'id'=item->>'optionId'))) THEN
          RETURN jsonb_build_object('error','QUESTION_ANSWER_INVALID');
        END IF;
      END LOOP;
      UPDATE assistant_questions SET status='answered',submission_id=submission,answers=answer_values,answered_at=NOW()
        WHERE id=q.id RETURNING * INTO updated;
      UPDATE assistant_turns SET continuation=continuation || jsonb_build_array(jsonb_build_object(
          'callId',q.call_id,'name','ask_question','arguments',jsonb_build_object('questions',q.questions),
          'result',jsonb_build_object('answers',answer_values))),
        segment=segment+1,status='running',lease_expires_at=NOW()+INTERVAL '60 seconds',completed_at=NULL
        WHERE id=t.id;
      INSERT INTO assistant_jobs(turn_id,segment) VALUES(t.id,t.segment+1) ON CONFLICT(turn_id) DO UPDATE SET
        segment=EXCLUDED.segment,workflow_id=NULL,claimed_at=NULL,attempts=0,dispatch_after=NOW();
      RETURN jsonb_build_object('question',to_jsonb(updated),'replayed',FALSE);
    END $$`;

  await sql`CREATE OR REPLACE FUNCTION append_assistant_event(run UUID, event JSONB)
    RETURNS INTEGER LANGUAGE plpgsql AS $$ DECLARE state TEXT; current_segment INTEGER; next_seq INTEGER;
    BEGIN
      SELECT status,segment INTO state,current_segment FROM assistant_turns WHERE id=run FOR UPDATE;
      IF state IS NULL OR (event ? 'segment' AND (event->>'segment')::INTEGER<>current_segment) THEN RETURN NULL; END IF;
      IF event->>'type' IN ('completed','failed','cancelled','awaiting_approval','awaiting_input') THEN
        IF state='running' OR (event->>'type'='awaiting_approval' AND state<>'awaiting_approval')
          OR (event->>'type'='awaiting_input' AND state<>'awaiting_input') THEN RETURN NULL; END IF;
        SELECT seq INTO next_seq FROM assistant_events WHERE turn_id=run AND payload->>'type'=event->>'type'
          AND COALESCE((payload->>'segment')::INTEGER,0)=current_segment LIMIT 1;
        IF next_seq IS NOT NULL THEN RETURN next_seq; END IF;
      ELSIF state<>'running' THEN RETURN NULL;
      END IF;
      SELECT COALESCE(MAX(seq),0)+1 INTO next_seq FROM assistant_events WHERE turn_id=run;
      INSERT INTO assistant_events(turn_id,seq,payload) VALUES(run,next_seq,event || jsonb_build_object('segment',current_segment));
      IF event->>'type'='answer-delta' THEN UPDATE assistant_turns SET output_text=CASE WHEN COALESCE((event->>'reset')::BOOLEAN,FALSE)
        THEN event->>'text' ELSE COALESCE(output_text,'') || (event->>'text') END WHERE id=run;
      ELSIF event->>'type'='evidence' THEN UPDATE assistant_turns SET citations=event->'citations' WHERE id=run; END IF;
      RETURN next_seq;
    END $$`;
}
