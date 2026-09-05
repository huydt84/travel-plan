import { createSqlAdapter } from "../lib/sql-adapter.mjs";
import { resolveDatabaseConfig } from "../lib/runtime-config.mjs";
import { normalizeTripImport } from "./trip-import-utils.mjs";
import { applyTripImport } from "./trip-import-store.mjs";

let data;
try {
  data = await import("./seed-data.mjs");
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  data = await import("./seed-data.example.mjs");
}
const startDate = data.trip.startDate || data.trip.date;
const payload = normalizeTripImport({
  trip: { ...data.trip, startDate, endDate: data.trip.endDate || startDate },
  sources: data.sources,
  schedule: data.activities,
});
const sql = createSqlAdapter(resolveDatabaseConfig());
try {
  await applyTripImport(sql, payload, { createOnly: true });
  console.log("Seed trip created.");
} catch (error) {
  if (error.code === "23505" && error.constraint === "trips_slug_key") {
    console.log("Seed trip already exists; no data changed.");
  } else {
    console.error(`Seed failed (${error.code || "SEED_FAILED"}). No changes committed.`);
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}
