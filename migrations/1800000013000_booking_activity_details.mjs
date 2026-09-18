import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);

  await sql`ALTER TABLE activities ADD COLUMN IF NOT EXISTS reservation_contacts JSONB NOT NULL DEFAULT '[]'::JSONB`;
  await sql`ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_reservation_contacts_array_check`;
  await sql`ALTER TABLE activities ADD CONSTRAINT activities_reservation_contacts_array_check
    CHECK (jsonb_typeof(reservation_contacts) = 'array')`;

  await sql`CREATE OR REPLACE FUNCTION validate_trip_activity_date_range()
  RETURNS TRIGGER AS $$
  DECLARE
    invalid_count INTEGER;
  BEGIN
    IF TG_TABLE_NAME = 'trips' THEN
      SELECT COUNT(*)::INTEGER INTO invalid_count
      FROM activities
      WHERE trip_id = NEW.id
        AND type NOT IN ('Reservation', 'FlightBooking')
        AND (start_date < NEW.trip_date OR end_date > NEW.end_date);
      IF invalid_count > 0 THEN
        RAISE EXCEPTION '% activities fall outside the trip date range', invalid_count
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF NEW.type IN ('Reservation', 'FlightBooking') THEN
        RETURN NEW;
      END IF;
      SELECT COUNT(*)::INTEGER INTO invalid_count
      FROM trips
      WHERE id = NEW.trip_id
        AND NEW.start_date >= trip_date
        AND NEW.end_date <= end_date;
      IF invalid_count = 0 THEN
        RAISE EXCEPTION 'activity falls outside the trip date range'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql`;

  await sql`DROP TRIGGER IF EXISTS activities_trip_date_range_trigger ON activities`;
  await sql`CREATE CONSTRAINT TRIGGER activities_trip_date_range_trigger
    AFTER INSERT OR UPDATE OF trip_id, start_date, end_date, type ON activities
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION validate_trip_activity_date_range()`;
}
