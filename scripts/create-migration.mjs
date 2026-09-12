import { readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

export function normalizeMigrationName(value) {
  const name = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!name) throw new Error("Provide a migration name, for example: pnpm run db:migration:new add-trip-status");
  return name;
}

export function nextMigrationId(fileNames, now = Date.now()) {
  const highest = fileNames
    .map((name) => Number(/^([0-9]+)_/.exec(name)?.[1]))
    .filter(Number.isSafeInteger)
    .reduce((maximum, value) => Math.max(maximum, value), 0);
  return Math.max(now, highest + 1);
}

export async function createMigration(name, { dir = migrationsDir, now = Date.now() } = {}) {
  const normalizedName = normalizeMigrationName(name);
  const id = nextMigrationId(await readdir(dir), now);
  const path = `${dir}/${id}_${normalizedName}.mjs`;
  await writeFile(path, `export const down = false;\n\nexport async function up(pgm) {\n  // Add the forward-only schema change here.\n}\n`, { flag: "wx" });
  return path;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createMigration(process.argv[2])
    .then((path) => console.log(`Created ${path}`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
