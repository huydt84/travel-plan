import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { seedLocalPersonas } from "../../scripts/local-persona-seed.mjs";

export default async function globalSetup() {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  try {
    await seedLocalPersonas(sql);
  } finally {
    await sql.end();
  }
}
