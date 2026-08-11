import { neon } from "@neondatabase/serverless";
import pg from "pg";

const { Pool } = pg;
const TRANSACTION_QUERY = Symbol("transaction-query");
const isolationLevels = {
  ReadCommitted: "READ COMMITTED",
  RepeatableRead: "REPEATABLE READ",
  Serializable: "SERIALIZABLE",
};

export function compileSqlTemplate(strings, values) {
  let text = strings[0];
  for (let index = 0; index < values.length; index += 1) {
    text += `$${index + 1}${strings[index + 1]}`;
  }
  return { text, values };
}

export function createPostgresSql(databaseUrl, { pool = null } = {}) {
  const connectionPool = pool || new Pool({
    connectionString: databaseUrl,
    max: 5,
    allowExitOnIdle: true,
  });

  const sql = async (strings, ...values) => {
    const result = await connectionPool.query(compileSqlTemplate(strings, values));
    return result.rows;
  };

  sql.transaction = async (buildQueries, options = {}) => {
    const client = await connectionPool.connect();
    try {
      await client.query("BEGIN");
      if (options.isolationLevel) {
        const isolationLevel = isolationLevels[options.isolationLevel];
        if (!isolationLevel) throw new Error(`Unsupported transaction isolation level: ${options.isolationLevel}`);
        await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
      }

      const transactionSql = (strings, ...values) => ({
        [TRANSACTION_QUERY]: true,
        ...compileSqlTemplate(strings, values),
      });
      const queries = await buildQueries(transactionSql);
      if (!Array.isArray(queries) || queries.some((query) => !query?.[TRANSACTION_QUERY])) {
        throw new Error("Transaction callback must return an array of SQL template queries");
      }

      const results = [];
      for (const query of queries) {
        const result = await client.query({ text: query.text, values: query.values });
        results.push(result.rows);
      }
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  sql.end = () => connectionPool.end();
  return sql;
}

export function createSqlAdapter({ databaseUrl, driver }) {
  if (driver === "postgres-tcp") return createPostgresSql(databaseUrl);
  if (driver === "neon-http") {
    const neonSql = neon(databaseUrl);
    const sql = (strings, ...values) => neonSql(strings, ...values);
    sql.transaction = (...args) => neonSql.transaction(...args);
    sql.end = async () => {};
    return sql;
  }
  throw new Error(`Unsupported database driver: ${driver}`);
}
