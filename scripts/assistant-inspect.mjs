// Read-only, narrow incident lookup. The repository resolves credentials
// internally; only operational fields are emitted, never provider payloads.
import { createSqlAdapter } from "../lib/sql-adapter.mjs";
import { resolveDatabaseConfig } from "../lib/runtime-config.mjs";
const id = process.argv[2];
if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new Error("A conversation UUID is required");
const byTurn = process.argv.includes("--turn");
let sql;
try {
  sql = createSqlAdapter(resolveDatabaseConfig());
  const turns = await sql`SELECT id,status,error_code AS code,created_at,completed_at,execution_settings,
    to_jsonb(t)->'error_diagnostics' AS diagnostics FROM assistant_turns t WHERE conversation_id=CASE WHEN ${byTurn} THEN (SELECT conversation_id FROM assistant_turns WHERE id=${id}::UUID) ELSE ${id}::UUID END ORDER BY created_at,id LIMIT 40`;
  const tools = await sql`SELECT r.turn_id,r.tool_name,r.status,r.error_code,r.duration_ms,r.result_metadata->'diagnostics' AS diagnostics
    FROM assistant_tool_runs r JOIN assistant_turns t ON t.id=r.turn_id WHERE t.conversation_id=CASE WHEN ${byTurn} THEN (SELECT conversation_id FROM assistant_turns WHERE id=${id}::UUID) ELSE ${id}::UUID END ORDER BY r.created_at LIMIT 200`;
  console.log(JSON.stringify({ turns, tools }, null, 2));
} catch { console.error("Incident lookup failed. Connection and provider details withheld."); process.exitCode = 1; }
finally { await sql?.end?.(); }
