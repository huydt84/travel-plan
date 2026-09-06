import { migrationSql } from "./support.mjs";
export const down = false;
export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`CREATE TABLE IF NOT EXISTS saved_places (
    id BIGSERIAL PRIMARY KEY, trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    name TEXT NOT NULL, address TEXT NOT NULL, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
    website TEXT, google_place_id TEXT, notes TEXT NOT NULL DEFAULT '',
    UNIQUE(id,trip_id), CHECK ((latitude IS NULL)=(longitude IS NULL)),
    CHECK(latitude BETWEEN -90 AND 90), CHECK(longitude BETWEEN -180 AND 180)
  )`;
  await sql`ALTER TABLE activities ADD COLUMN IF NOT EXISTS place_id BIGINT`;
  await sql`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='activities_saved_place_trip_fk') THEN
    ALTER TABLE activities ADD CONSTRAINT activities_saved_place_trip_fk FOREIGN KEY(place_id,trip_id) REFERENCES saved_places(id,trip_id);
  END IF; END $$`;
  await sql`DROP TRIGGER IF EXISTS saved_places_revision ON saved_places`;
  await sql`CREATE TRIGGER saved_places_revision AFTER INSERT OR UPDATE OR DELETE ON saved_places FOR EACH ROW EXECUTE FUNCTION bump_trip_plan_revision()`;
  await sql`ALTER TABLE assistant_turns DROP CONSTRAINT IF EXISTS assistant_turns_status_check`;
  await sql`ALTER TABLE assistant_turns ADD CONSTRAINT assistant_turns_status_check CHECK(status IN ('running','awaiting_approval','completed','failed'))`;
  await sql`ALTER TABLE assistant_turns ADD COLUMN IF NOT EXISTS continuation JSONB NOT NULL DEFAULT '[]'`;
  await sql`ALTER TABLE assistant_turns ADD COLUMN IF NOT EXISTS segment INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE assistant_jobs ADD COLUMN IF NOT EXISTS segment INTEGER NOT NULL DEFAULT 0`;
  await sql`DROP INDEX IF EXISTS assistant_turns_one_running_idx`;
  await sql`CREATE UNIQUE INDEX assistant_turns_one_running_idx ON assistant_turns(conversation_id) WHERE status IN ('running','awaiting_approval')`;
  await sql`CREATE TABLE IF NOT EXISTS assistant_actions (
    id UUID PRIMARY KEY, turn_id UUID NOT NULL REFERENCES assistant_turns(id) ON DELETE CASCADE,
    segment INTEGER NOT NULL, call_id TEXT NOT NULL, tool_name TEXT NOT NULL CHECK(tool_name='apply_changes'),
    arguments JSONB NOT NULL, operations JSONB NOT NULL, revisions JSONB NOT NULL, preview JSONB NOT NULL,
    citations JSONB NOT NULL, digest TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','rejected','expired','conflicted','cancelled','failed')),
    receipt JSONB, error_code TEXT, decided_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(turn_id,segment)
  )`;
  await sql`UPDATE assistant_change_sets SET status='superseded' WHERE status='staged'`;
  // Stopped/expired turns cannot retain an actionable approval, including owner Stop.
  await sql`CREATE OR REPLACE FUNCTION assistant_cancel_actions() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN IF NEW.status='failed' THEN UPDATE assistant_actions SET status='cancelled',decided_at=NOW() WHERE turn_id=NEW.id AND status='pending'; END IF; RETURN NEW; END $$`;
  await sql`DROP TRIGGER IF EXISTS assistant_cancel_actions_trigger ON assistant_turns`;
  await sql`CREATE TRIGGER assistant_cancel_actions_trigger AFTER UPDATE OF status ON assistant_turns FOR EACH ROW EXECUTE FUNCTION assistant_cancel_actions()`;
  // The immutable payload is the authority for both preview and execution.
  await sql`CREATE OR REPLACE FUNCTION assistant_action_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
    IF (to_jsonb(NEW)-ARRAY['status','receipt','error_code','decided_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','receipt','error_code','decided_at']) THEN RAISE EXCEPTION 'Immutable assistant action'; END IF;
    RETURN NEW; END $$`;
  await sql`DROP TRIGGER IF EXISTS assistant_action_immutable_trigger ON assistant_actions`;
  await sql`CREATE TRIGGER assistant_action_immutable_trigger BEFORE UPDATE ON assistant_actions FOR EACH ROW EXECUTE FUNCTION assistant_action_immutable()`;
  await sql`CREATE OR REPLACE FUNCTION assistant_ref_id(ref JSONB, ids JSONB) RETURNS BIGINT LANGUAGE plpgsql AS $$
    DECLARE result BIGINT;
    BEGIN
      IF ref IS NULL OR ref='null'::JSONB THEN RETURN NULL; END IF;
      result := COALESCE(ref->>'id',ids->>(ref->>'draftId'))::BIGINT;
      IF result IS NULL THEN RAISE EXCEPTION 'Missing batch reference'; END IF;
      RETURN result;
    END $$`;
  await sql`CREATE OR REPLACE FUNCTION execute_assistant_action(action_id UUID, actor TEXT, approved_digest TEXT)
    RETURNS JSONB LANGUAGE plpgsql AS $$
    DECLARE a assistant_actions%ROWTYPE; t assistant_turns%ROWTYPE; p JSONB; op JSONB; v JSONB; r JSONB;
      ids JSONB := '{}'; resources JSONB := '[]'; revisions JSONB := '{}'; resource_id BIGINT; trip BIGINT;
      target BIGINT; expected BIGINT; actual BIGINT; source JSONB; audit_id UUID; error_state TEXT;
    BEGIN
      SELECT * INTO a FROM assistant_actions WHERE id=action_id;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PA404',MESSAGE='ACTION_NOT_FOUND'; END IF;
      SELECT at.* INTO t FROM assistant_turns at JOIN assistant_conversations c ON c.id=at.conversation_id
        WHERE at.id=a.turn_id AND c.owner_email=actor FOR UPDATE OF at;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PA404',MESSAGE='ACTION_NOT_FOUND'; END IF;
      SELECT * INTO a FROM assistant_actions WHERE id=action_id FOR UPDATE;
      p := assistant_effective_policy(actor);
      IF NOT (p->>'enabled')::BOOLEAN THEN RAISE EXCEPTION USING ERRCODE='PA001',MESSAGE='ASSISTANT_DISABLED'; END IF;
      IF a.digest<>approved_digest THEN RAISE EXCEPTION USING ERRCODE='PA403',MESSAGE='CONFIRMATION_INVALID'; END IF;
      IF a.status='applied' THEN RETURN a.receipt; END IF;
      IF a.status<>'pending' OR t.status<>'awaiting_approval' OR a.segment<>t.segment THEN
        RETURN jsonb_build_object('error','ACTION_RESOLVED');
      END IF;
      IF a.expires_at<=NOW() THEN
        UPDATE assistant_actions SET status='expired',decided_at=NOW() WHERE id=a.id;
        UPDATE assistant_turns SET status='completed',completed_at=NOW() WHERE id=t.id;
        RETURN jsonb_build_object('error','ACTION_EXPIRED');
      END IF;
      FOR target,expected IN SELECT key::BIGINT,value::TEXT::BIGINT FROM jsonb_each(a.revisions) ORDER BY key::BIGINT LOOP
        SELECT plan_revision INTO actual FROM trips WHERE id=target FOR UPDATE;
        IF NOT FOUND OR actual<>expected THEN
          UPDATE assistant_actions SET status='conflicted',decided_at=NOW() WHERE id=a.id;
          UPDATE assistant_turns SET status='completed',completed_at=NOW() WHERE id=t.id;
          RETURN jsonb_build_object('error','PLAN_CONFLICT');
        END IF;
      END LOOP;
      audit_id := gen_random_uuid();
      INSERT INTO assistant_tool_runs(id,turn_id,tool_name,status,request_metadata)
        VALUES(audit_id,t.id,'apply_changes','running',jsonb_build_object('actionId',a.id,'operationCount',jsonb_array_length(a.operations)));
      BEGIN
        FOR op IN SELECT value FROM jsonb_array_elements(a.operations) LOOP
          v := op->'value'; trip := CASE WHEN op->>'kind'='trip.create' THEN NULL ELSE assistant_ref_id(op->'trip',ids) END;
          resource_id := CASE WHEN op->>'kind' LIKE '%.update' THEN assistant_ref_id(op->'ref',ids) ELSE NULL END;
          CASE op->>'kind'
          WHEN 'trip.create' THEN
            INSERT INTO trips(slug,title,trip_date,end_date,timezone,location) VALUES(v->>'slug',v->>'title',(v->>'startDate')::DATE,(v->>'endDate')::DATE,v->>'timezone',v->>'location') RETURNING id INTO resource_id;
            trip := resource_id;
          WHEN 'trip.update' THEN
            UPDATE trips SET slug=v->>'slug',title=v->>'title',trip_date=(v->>'startDate')::DATE,end_date=(v->>'endDate')::DATE,timezone=v->>'timezone',location=v->>'location',updated_at=NOW() WHERE id=resource_id;
            IF NOT FOUND THEN RAISE EXCEPTION 'Missing trip'; END IF;
          WHEN 'source.create' THEN
            INSERT INTO sources(trip_id,source_number,title,host,url) VALUES(trip,(v->>'number')::INTEGER,v->>'title',v->>'host',v->>'url') RETURNING id INTO resource_id;
          WHEN 'source.update' THEN
            UPDATE sources SET title=v->>'title',host=v->>'host',url=v->>'url' WHERE id=resource_id AND trip_id=trip;
            IF NOT FOUND THEN RAISE EXCEPTION 'Missing source'; END IF;
          WHEN 'place.create' THEN
            INSERT INTO saved_places(trip_id,name,address,latitude,longitude,website,google_place_id,notes)
              VALUES(trip,v->>'name',v->>'address',(v->>'latitude')::DOUBLE PRECISION,(v->>'longitude')::DOUBLE PRECISION,v->>'website',v->>'googlePlaceId',v->>'notes') RETURNING id INTO resource_id;
          WHEN 'place.update' THEN
            UPDATE saved_places SET name=v->>'name',address=v->>'address',latitude=(v->>'latitude')::DOUBLE PRECISION,longitude=(v->>'longitude')::DOUBLE PRECISION,website=v->>'website',google_place_id=v->>'googlePlaceId',notes=v->>'notes' WHERE id=resource_id AND trip_id=trip;
            IF NOT FOUND THEN RAISE EXCEPTION 'Missing place'; END IF;
          WHEN 'activity.create' THEN
            INSERT INTO activities(trip_id,item_key,sort_order,start_date,start_time,end_date,end_time,display_end,type,icon,title,detail,branch_id,place_id)
              VALUES(trip,v->>'key',COALESCE((SELECT MAX(sort_order)+1 FROM activities WHERE trip_id=trip AND branch_id IS NOT DISTINCT FROM (v->>'branchId')::BIGINT),0),
              (v->>'startDate')::DATE,(v->>'start')::TIME,(v->>'endDate')::DATE,(v->>'end')::TIME,v->>'displayEnd',v->>'type',v->>'icon',v->>'title',v->>'detail',(v->>'branchId')::BIGINT,assistant_ref_id(v->'place',ids)) RETURNING id INTO resource_id;
          WHEN 'activity.update' THEN
            UPDATE activities SET start_date=(v->>'startDate')::DATE,start_time=(v->>'start')::TIME,end_date=(v->>'endDate')::DATE,end_time=(v->>'end')::TIME,
              display_end=v->>'displayEnd',type=v->>'type',icon=v->>'icon',title=v->>'title',detail=v->>'detail',place_id=assistant_ref_id(v->'place',ids)
              WHERE id=resource_id AND trip_id=trip AND item_key=v->>'key' AND branch_id IS NOT DISTINCT FROM (v->>'branchId')::BIGINT;
            IF NOT FOUND THEN RAISE EXCEPTION 'Missing activity'; END IF;
          ELSE RAISE EXCEPTION 'Unsupported batch operation';
          END CASE;
          IF op->'ref' ? 'draftId' THEN ids := ids || jsonb_build_object(op->'ref'->>'draftId',resource_id::TEXT); END IF;
          IF op->>'kind' LIKE 'activity.%' THEN
            DELETE FROM activity_sources WHERE activity_id=resource_id;
            FOR source IN SELECT value FROM jsonb_array_elements(v->'sources') LOOP
              target := assistant_ref_id(source,ids);
              IF NOT EXISTS(SELECT 1 FROM sources WHERE id=target AND trip_id=trip) THEN RAISE EXCEPTION 'Cross-trip source'; END IF;
              INSERT INTO activity_sources(activity_id,source_id) VALUES(resource_id,target) ON CONFLICT DO NOTHING;
            END LOOP;
          END IF;
          resources := resources || jsonb_build_array(jsonb_build_object('kind',split_part(op->>'kind','.',1),'id',resource_id::TEXT,'tripId',trip::TEXT,'title',COALESCE(v->>'title',v->>'name')));
        END LOOP;
        SET CONSTRAINTS ALL IMMEDIATE;
        FOR trip IN SELECT DISTINCT (value->>'tripId')::BIGINT FROM jsonb_array_elements(resources) LOOP
          SELECT plan_revision INTO actual FROM trips WHERE id=trip;
          revisions := revisions || jsonb_build_object(trip::TEXT,actual);
        END LOOP;
        SELECT COALESCE(jsonb_agg(value || jsonb_build_object('href','/?trip=' || tr.slug || CASE WHEN value->>'kind'='place' THEN '#place-' || (value->>'id') WHEN value->>'kind'='activity' THEN '#' || (value->>'id') WHEN value->>'kind'='source' THEN '#sources-title' ELSE '' END)),'[]') INTO resources
          FROM jsonb_array_elements(resources) JOIN trips tr ON tr.id=(value->>'tripId')::BIGINT;
        r := jsonb_build_object('actionId',a.id,'resources',resources,'createdIds',ids,'revisions',revisions,'appliedAt',NOW(),'summary',a.preview->>'summary');
        UPDATE assistant_actions SET status='applied',receipt=r,decided_at=NOW() WHERE id=a.id;
        UPDATE assistant_tool_runs SET status='completed',result_metadata=r WHERE id=audit_id;
        UPDATE assistant_turns SET continuation=continuation || jsonb_build_array(jsonb_build_object('callId',a.call_id,'arguments',a.arguments,'receipt',r)),
          segment=segment+1,status='running',lease_expires_at=NOW()+INTERVAL '60 seconds',completed_at=NULL WHERE id=t.id;
        INSERT INTO assistant_jobs(turn_id,segment) VALUES(t.id,t.segment+1) ON CONFLICT(turn_id) DO UPDATE SET
          segment=EXCLUDED.segment,workflow_id=NULL,claimed_at=NULL,attempts=0,dispatch_after=NOW();
        RETURN r;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS error_state=RETURNED_SQLSTATE;
        UPDATE assistant_actions SET status='failed',error_code=error_state,decided_at=NOW() WHERE id=a.id;
        UPDATE assistant_tool_runs SET status='failed',error_code=error_state WHERE id=audit_id;
        UPDATE assistant_turns SET status='completed',completed_at=NOW(),lease_expires_at=NULL WHERE id=t.id;
        RETURN jsonb_build_object('error','ACTION_FAILED');
      END;
    END $$`;
  // Segment fencing prevents delayed workers from claiming a later continuation.
  await sql`CREATE OR REPLACE FUNCTION claim_assistant_segment(run UUID, lease_ms INTEGER, workflow TEXT, expected_segment INTEGER)
    RETURNS BOOLEAN LANGUAGE plpgsql AS $$ BEGIN
      PERFORM 1 FROM assistant_turns WHERE id=run AND segment=expected_segment AND status='running' AND lease_expires_at>NOW() FOR UPDATE;
      IF NOT FOUND THEN RETURN FALSE; END IF;
      UPDATE assistant_jobs SET claimed_at=NOW(),workflow_id=workflow WHERE turn_id=run AND segment=expected_segment AND claimed_at IS NULL;
      IF NOT FOUND THEN RETURN FALSE; END IF;
      UPDATE assistant_turns SET lease_expires_at=NOW()+lease_ms*INTERVAL '1 millisecond' WHERE id=run;
      RETURN TRUE;
    END $$`;
  await sql`CREATE OR REPLACE FUNCTION append_assistant_event(run UUID, event JSONB)
    RETURNS INTEGER LANGUAGE plpgsql AS $$ DECLARE state TEXT; current_segment INTEGER; next_seq INTEGER;
    BEGIN
      SELECT status,segment INTO state,current_segment FROM assistant_turns WHERE id=run FOR UPDATE;
      IF state IS NULL OR (event ? 'segment' AND (event->>'segment')::INTEGER<>current_segment) THEN RETURN NULL; END IF;
      IF event->>'type' IN ('completed','failed','cancelled','awaiting_approval') THEN
        IF state='running' OR (event->>'type'='awaiting_approval' AND state<>'awaiting_approval') THEN RETURN NULL; END IF;
        SELECT seq INTO next_seq FROM assistant_events WHERE turn_id=run AND payload->>'type'=event->>'type' AND COALESCE((payload->>'segment')::INTEGER,0)=current_segment LIMIT 1;
        IF next_seq IS NOT NULL THEN RETURN next_seq; END IF;
      ELSIF state<>'running' THEN RETURN NULL;
      END IF;
      SELECT COALESCE(MAX(seq),0)+1 INTO next_seq FROM assistant_events WHERE turn_id=run;
      INSERT INTO assistant_events(turn_id,seq,payload) VALUES(run,next_seq,event || jsonb_build_object('segment',current_segment));
      IF event->>'type'='answer-delta' THEN UPDATE assistant_turns SET output_text=CASE WHEN COALESCE((event->>'reset')::BOOLEAN,FALSE) THEN event->>'text' ELSE COALESCE(output_text,'') || (event->>'text') END WHERE id=run;
      ELSIF event->>'type'='evidence' THEN UPDATE assistant_turns SET citations=event->'citations' WHERE id=run; END IF;
      RETURN next_seq;
    END $$`;
}
