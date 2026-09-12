import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMigration, nextMigrationId, normalizeMigrationName } from "./create-migration.mjs";

test("migration ids remain monotonic when the latest migration is future-dated", () => {
  assert.equal(nextMigrationId(["1800000006000_existing.mjs"], 1789200000000), 1800000006001);
  assert.equal(nextMigrationId(["1789000000000_existing.mjs"], 1789200000000), 1789200000000);
});

test("creates a normalized forward migration after the highest existing id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "travel-migration-create-"));
  try {
    await writeFile(join(dir, "1800000006000_existing.mjs"), "");
    const path = await createMigration(" Add Trip Status ", { dir, now: 1789200000000 });
    assert.equal(path, join(dir, "1800000006001_add-trip-status.mjs"));
    assert.deepEqual((await readdir(dir)).sort(), ["1800000006000_existing.mjs", "1800000006001_add-trip-status.mjs"]);
    assert.match(await readFile(path, "utf8"), /export async function up/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects an empty migration name", () => {
  assert.throws(() => normalizeMigrationName("---"), /Provide a migration name/);
});
