import pg from "pg";
import { readdir } from "node:fs/promises";
import { resolveDatabaseConfig } from "../lib/runtime-config.mjs";

// A short-lived database gate also covers the old deployed application's API.
// Existing turns and workers can finish; new turn transactions roll back.
const mode = process.argv[2] || "status";
if (!["status", "pause", "resume"].includes(mode)) throw new Error("Use status, pause, or resume");
let client;
try {
  client = new pg.Client({ connectionString: resolveDatabaseConfig().databaseUrl });
  await client.connect();
  if (mode === "pause") {
    await client.query("BEGIN");
    await client.query(`CREATE OR REPLACE FUNCTION assistant_deployment_pause() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Assistant temporarily paused for deployment' USING ERRCODE='55000'; END; $$`);
    await client.query("DROP TRIGGER IF EXISTS assistant_deployment_pause ON assistant_turns");
    await client.query("CREATE TRIGGER assistant_deployment_pause BEFORE INSERT ON assistant_turns FOR EACH ROW EXECUTE FUNCTION assistant_deployment_pause()");
    await client.query("COMMIT");
  } else if (mode === "resume") {
    await client.query("BEGIN");
    await client.query("DROP TRIGGER IF EXISTS assistant_deployment_pause ON assistant_turns");
    await client.query("DROP FUNCTION IF EXISTS assistant_deployment_pause()");
    await client.query("COMMIT");
  }
  const { rows: [runs] } = await client.query("SELECT COUNT(*)::INTEGER AS active FROM assistant_turns WHERE status='running' AND lease_expires_at>NOW()");
  const { rows: [gate] } = await client.query("SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='assistant_turns'::regclass AND tgname='assistant_deployment_pause') AS paused");
  const { rows: applied } = await client.query("SELECT name FROM pgmigrations");
  const names = new Set(applied.map((row) => row.name));
  const files = (await readdir(new URL("../migrations", import.meta.url))).filter((file) => /^\d.*\.mjs$/.test(file)).sort();
  console.log(JSON.stringify({ paused: gate.paused, activeRuns: runs.active, pendingMigrations: files.filter((file) => !names.has(file.replace(/\.mjs$/, ""))) }));
} catch (error) {
  await client?.query("ROLLBACK").catch(() => {});
  console.error(`Assistant deployment check failed (${error.code || "DEPLOYMENT_CHECK_FAILED"}).`);
  process.exitCode = 1;
} finally { await client?.end(); }
