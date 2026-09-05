import { runMigrations } from "./migration-runner.mjs";

try {
  const applied = await runMigrations();
  console.log(`Schema ready: ${applied.length} migration(s) applied. Seed data is managed separately.`);
} catch (error) {
  // Driver errors may contain query values. Never print raw errors or connection details.
  console.error(`Migration failed (${error.code || "MIGRATION_FAILED"}). Changes were rolled back; check the migration and required configuration.`);
  process.exitCode = 1;
}
