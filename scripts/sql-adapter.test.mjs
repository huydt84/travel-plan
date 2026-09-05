import assert from "node:assert/strict";
import test from "node:test";
import { compileSqlTemplate, createPostgresSql } from "../lib/sql-adapter.mjs";

test("compiles tagged templates into parameterized node-postgres queries", () => {
  assert.deepEqual(
    compileSqlTemplate(["SELECT ", "::INTEGER AS value, ", "::TEXT AS label"], [42, "answer"]),
    {
      text: "SELECT $1::INTEGER AS value, $2::TEXT AS label",
      values: [42, "answer"],
    },
  );
});

test("executes tagged queries through the shared SQL interface", async () => {
  const calls = [];
  const pool = {
    query: async (query) => { calls.push(query); return { rows: [{ value: 42 }] }; },
    end: async () => { calls.push("END"); },
  };
  const sql = createPostgresSql("postgresql://unused", { pool });

  assert.deepEqual(await sql`SELECT ${42}::INTEGER AS value`, [{ value: 42 }]);
  assert.deepEqual(calls[0], { text: "SELECT $1::INTEGER AS value", values: [42] });
  await sql.end();
  assert.equal(calls.at(-1), "END");
});

test("runs transaction templates sequentially at the requested isolation level", async () => {
  const calls = [];
  let released = false;
  const client = {
    query: async (query) => { calls.push(query); return { rows: [{ ok: true }] }; },
    release: () => { released = true; },
  };
  const pool = { connect: async () => client, end: async () => {} };
  const sql = createPostgresSql("postgresql://unused", { pool });

  const results = await sql.transaction((tx) => [
    tx`INSERT INTO example (value) VALUES (${1})`,
    tx`UPDATE example SET value = ${2} WHERE value = ${1}`,
  ], { isolationLevel: "Serializable" });

  assert.deepEqual(calls, [
    "BEGIN",
    "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
    { text: "INSERT INTO example (value) VALUES ($1)", values: [1] },
    { text: "UPDATE example SET value = $1 WHERE value = $2", values: [2, 1] },
    "COMMIT",
  ]);
  assert.deepEqual(results, [[{ ok: true }], [{ ok: true }]]);
  assert.equal(released, true);
});

test("rolls back and releases the connection when a transaction fails", async () => {
  const calls = [];
  let released = false;
  const client = {
    query: async (query) => { calls.push(query); return { rows: [] }; },
    release: () => { released = true; },
  };
  const pool = { connect: async () => client, end: async () => {} };
  const sql = createPostgresSql("postgresql://unused", { pool });

  await assert.rejects(sql.transaction(() => ["not a query"]), /must return an array/);
  assert.deepEqual(calls, ["BEGIN", "ROLLBACK"]);
  assert.equal(released, true);
});

test("shared schedule fragments use Neon's real tagged-template and batch interfaces", async () => {
  const { neonConfig } = await import("@neondatabase/serverless");
  const { createSqlAdapter } = await import("../lib/sql-adapter.mjs");
  const { saveScheduleRecord } = await import("../lib/schedule-store.mjs");
  const previousFetch = neonConfig.fetchFunction;
  const batches = [];
  neonConfig.fetchFunction = async (_url, options) => {
    const batch = JSON.parse(options.body);
    batches.push(batch);
    assert.equal(options.headers["Neon-Batch-Isolation-Level"], "Serializable");
    return { ok: true, json: async () => ({ results: batch.queries.map((_, index) => ({ fields: index === 0 ? [{ name: "id", dataTypeID: 20 }] : [], rows: index === 0 ? [["42"]] : [] })) }) };
  };
  try {
    const sql = createSqlAdapter({ driver: "neon-http", databaseUrl: "postgresql://test:test@database.invalid/test" });
    const title = "It's a title; DROP TABLE activities; --";
    assert.equal(await saveScheduleRecord(sql, { tripId: "7", itemKey: "safe-key", input: { startDate: "2030-01-01", start: "09:00", endDate: "2030-01-01", end: "10:00", type: "Visit", icon: "x", title, detail: "" }, sourceIds: [1] }), "42");
    assert.equal(batches[0].queries.length, 3);
    assert.ok(batches[0].queries[0].params.includes(title));
    assert.ok(!batches[0].queries[0].query.includes(title));
    await saveScheduleRecord(sql, { tripId: "7", activityId: "42", input: { title: "Update" } });
    assert.equal(batches[1].queries.length, 1);
  } finally {
    neonConfig.fetchFunction = previousFetch;
  }
});
