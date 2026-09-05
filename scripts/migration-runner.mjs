import { fileURLToPath } from "node:url";
import pg from "pg";
import { runner } from "node-pg-migrate";
import { resolveDatabaseConfig, resolveLocalAdminMode } from "../lib/runtime-config.mjs";

// Use a dedicated TCP session for the migration tool's transaction and advisory
// lock. Application traffic continues to use Neon HTTP in production.
export async function runMigrations({ env = process.env, schema = "public", dir = fileURLToPath(new URL("../migrations", import.meta.url)), log = console.log } = {}) {
  const config = resolveDatabaseConfig(env);
  const local = resolveLocalAdminMode(env);
  const owner = env.AUTH_OWNER_EMAIL?.trim().toLowerCase() || (local.enabled ? "local-admin@localhost.invalid" : "");
  const client = new pg.Client({ connectionString: config.databaseUrl });
  try {
    await client.connect();
    await client.query("SELECT set_config('app.migration_owner', $1, false)", [owner]);
    return await runner({
      dbClient: client, dir, schema, migrationsSchema: schema, migrationsTable: "pgmigrations",
      direction: "up", singleTransaction: true, checkOrder: true,
      ignorePattern: "(?![0-9]).*", verbose: false,
      logger: { info: log, warn: log, error() {} },
    });
  } finally {
    await client.end();
  }
}
