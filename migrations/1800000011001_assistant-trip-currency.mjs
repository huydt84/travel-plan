import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);
  await sql`CREATE OR REPLACE FUNCTION protect_expense_trip_currency() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.currency<>OLD.currency AND EXISTS(SELECT 1 FROM activity_expenses WHERE trip_id=OLD.id) THEN
        RAISE EXCEPTION 'Trip currency is locked by existing expenses' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$`;
  await sql`DROP TRIGGER IF EXISTS trips_expense_currency_lock_trigger ON trips`;
  await sql`CREATE TRIGGER trips_expense_currency_lock_trigger BEFORE UPDATE OF currency ON trips
    FOR EACH ROW EXECUTE FUNCTION protect_expense_trip_currency()`;
  await sql`DROP FUNCTION IF EXISTS execute_assistant_action_without_currency(UUID,TEXT,TEXT)`;
  await sql`ALTER FUNCTION execute_assistant_action(UUID,TEXT,TEXT)
    RENAME TO execute_assistant_action_without_currency`;
  await sql`CREATE OR REPLACE FUNCTION execute_assistant_action(action_id UUID, actor TEXT, approved_digest TEXT)
    RETURNS JSONB LANGUAGE plpgsql AS $$
    DECLARE result JSONB; action_row assistant_actions%ROWTYPE; op JSONB; trip_id BIGINT; next_currency TEXT;
    BEGIN
      SELECT * INTO action_row FROM assistant_actions WHERE id=action_id;
      result := execute_assistant_action_without_currency(action_id,actor,approved_digest);
      IF result ? 'error' THEN RETURN result; END IF;
      FOR op IN SELECT value FROM jsonb_array_elements(action_row.operations) LOOP
        IF op->>'kind' NOT IN ('trip.create','trip.update') THEN CONTINUE; END IF;
        next_currency := op->'value'->>'currency';
        IF next_currency IS NULL THEN CONTINUE; END IF;
        IF op->>'kind'='trip.create' THEN
          trip_id := (result->'createdIds'->>(op->'ref'->>'draftId'))::BIGINT;
        ELSE
          trip_id := assistant_ref_id(op->'ref',result->'createdIds');
        END IF;
        UPDATE trips trip SET currency=next_currency
        WHERE trip.id=trip_id AND (trip.currency=next_currency OR NOT EXISTS(
          SELECT 1 FROM activity_expenses expense WHERE expense.trip_id=trip.id
        ));
        IF NOT FOUND THEN RAISE EXCEPTION 'Trip currency is locked by existing expenses' USING ERRCODE='23514'; END IF;
      END LOOP;
      RETURN result;
    END $$`;
}
