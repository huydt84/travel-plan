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
