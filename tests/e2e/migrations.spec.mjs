import pg from "pg";
import { mkdtemp, writeFile, rm, cp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { expect, test } from "./fixtures.mjs";

const migrationCount = (await readdir(new URL("../../migrations", import.meta.url))).filter((name) => /^\d+.*\.mjs$/.test(name)).length;

const env = { NODE_ENV: "development", LOCAL_ADMIN_BYPASS: "true" };
async function isolatedSchema(run) {
  const client = new pg.Client({ connectionString: DEFAULT_LOCAL_POSTGRES_URI });
  const schema = `migration_test_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await run(client, (options = {}) => runMigrations({ env, schema, log() {}, ...options }));
  } finally {
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    await client.end();
  }
}

test("fresh schema, legacy adoption, and reruns preserve data and enforce constraints", async () => {
  await isolatedSchema(async (db, migrate) => {
    expect(await migrate()).toHaveLength(migrationCount);
    expect((await db.query("SELECT * FROM trips")).rows).toEqual([]);
    const { rows: [trip] } = await db.query(`INSERT INTO trips (slug,title,trip_date,end_date,timezone,location)
      VALUES ('kept','Edited title','2032-01-01','2032-01-02','Asia/Tokyo','Edited location') RETURNING *`);
    await db.query("INSERT INTO users (email, name, role, first_login, last_login, last_active_at) VALUES ('member@example.com','Member','member',NOW(),NOW(),NOW())");
    const { rows: [activity] } = await db.query(`INSERT INTO activities
      (trip_id,item_key,sort_order,start_date,start_time,end_date,end_time,type,icon,title,detail)
      VALUES ($1,'stable-key',0,'2032-01-01','09:00','2032-01-01','10:00','Visit','x','Kept','') RETURNING id`, [trip.id]);
    await db.query(`INSERT INTO suggestions (trip_id,activity_id,author_email,author_name,body)
      VALUES ($1,$2,'member@example.com','Member','Preserve me')`, [trip.id, activity.id]);
    await expect(db.query("UPDATE users SET role = 'superuser'")).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("UPDATE activities SET end_time = '08:00'")).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("UPDATE trips SET trip_date = '2032-01-02'")).rejects.toMatchObject({ code: "23514" });
    await expect(db.query(`INSERT INTO trip_requests (requester_email,start_date,end_date)
      VALUES ('member@example.com','2032-01-02','2032-01-01')`)).rejects.toMatchObject({ code: "23514" });
    await expect(db.query(`INSERT INTO notifications (recipient_email,trip_id,event_type,actor_name)
      VALUES ('member@example.com',$1,'contribution_created','Member')`, [trip.id])).rejects.toMatchObject({ code: "23514" });
    // A current installation predating the ledger must be adopted without seeding.
    await db.query("DELETE FROM users");
    await db.query("DROP TABLE pgmigrations");
    expect(await migrate()).toHaveLength(migrationCount);
    expect((await db.query("SELECT email,name FROM users")).rows).toEqual([{ email: "member@example.com", name: "Member" }]);
    const before = (await db.query("SELECT * FROM trips")).rows;
    expect(before[0]).toMatchObject({ title: "Edited title", location: "Edited location" });
    expect((await db.query("SELECT item_key FROM activities")).rows).toEqual([{ item_key: "stable-key" }]);
    expect(await migrate()).toHaveLength(0);
    expect((await db.query("SELECT * FROM trips")).rows).toEqual(before);
    await db.query("DELETE FROM activities");
    expect((await db.query("SELECT activity_id,body FROM suggestions")).rows).toEqual([{ activity_id: null, body: "Preserve me" }]);
    expect((await db.query("SELECT * FROM trip_participants")).rows).toHaveLength(1);
    for (const table of ["invitation_permissions", "invitation_deliveries", "invitation_batches", "trip_request_places", "trip_request_sources", "trip_request_fulfillments", "admin_notification_outbox", "assistant_change_sets", "assistant_requests"]) {
      expect((await db.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
    }
  });
});

test("old single-day schedules acquire dates, stable keys, and contributor identities", async () => {
  await isolatedSchema(async (db, migrate) => {
    await db.query(`CREATE TABLE trips (id BIGSERIAL PRIMARY KEY,slug TEXT UNIQUE NOT NULL,title TEXT NOT NULL,
      trip_date DATE NOT NULL,timezone TEXT NOT NULL,location TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      INSERT INTO trips (slug,title,trip_date,timezone,location) VALUES ('legacy','Legacy','2030-01-01','Asia/Tokyo','Tokyo');
      CREATE TABLE activities (id BIGSERIAL PRIMARY KEY,trip_id BIGINT NOT NULL REFERENCES trips(id),sort_order INTEGER NOT NULL,
        start_time TIME NOT NULL,end_time TIME NOT NULL,display_end TEXT,type TEXT NOT NULL,icon TEXT NOT NULL,title TEXT NOT NULL,detail TEXT NOT NULL,
        UNIQUE(trip_id,sort_order));
      INSERT INTO activities (trip_id,sort_order,start_time,end_time,type,icon,title,detail)
      VALUES (1,0,'09:00','10:00','Visit','x','Same title',''),(1,1,'11:00','12:00','Visit','x','Same title','');`);
    expect(await migrate()).toHaveLength(migrationCount);
    expect((await db.query("SELECT item_key,TO_CHAR(start_date,'YYYY-MM-DD') AS date FROM activities ORDER BY sort_order")).rows)
      .toEqual([{ item_key: "same-title", date: "2030-01-01" }, { item_key: "same-title-2", date: "2030-01-01" }]);
  });
});

test("a failed migration rolls back its DDL and ledger entry and can be retried", async () => {
  const dir = await mkdtemp(join(tmpdir(), "travel-migrations-"));
  try {
    await cp(new URL("../../migrations", import.meta.url), dir, { recursive: true });
    await isolatedSchema(async (db, migrate) => {
      await migrate();
      const file = join(dir, "1788652800001_failure.mjs");
      await writeFile(file, "export async function up(pgm) { await pgm.db.query('CREATE TABLE rollback_probe (id INTEGER)'); await pgm.db.query('SELECT * FROM retry_dependency'); }");
      await expect(migrate({ dir })).rejects.toThrow();
      expect((await db.query("SELECT to_regclass('rollback_probe') AS name")).rows[0].name).toBeNull();
      expect((await db.query("SELECT * FROM pgmigrations")).rows).toHaveLength(migrationCount);
      await db.query("CREATE TABLE retry_dependency (id INTEGER)");
      expect(await migrate({ dir })).toHaveLength(1);
      expect((await db.query("SELECT to_regclass('rollback_probe') AS name")).rows[0].name).toBe("rollback_probe");
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
