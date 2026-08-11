import { resolveDatabaseConfig } from "./runtime-config.mjs";
import { createSqlAdapter } from "./sql-adapter.mjs";

let sqlClient;
let sqlClientKey;

export function getSql() {
  const config = resolveDatabaseConfig();
  const clientKey = `${config.driver}:${config.databaseUrl}`;
  if (!sqlClient || sqlClientKey !== clientKey) {
    sqlClient = createSqlAdapter(config);
    sqlClientKey = clientKey;
  }
  return sqlClient;
}
