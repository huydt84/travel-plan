import { USER_ACTIVITY_WRITE_INTERVAL_MS } from "./user-activity.mjs";

const textValue = (value) => typeof value === "string" ? value.trim() : "";

export function normalizeLoginIdentity(input = {}) {
  const email = textValue(input.email).toLowerCase();
  if (!email) throw new Error("A verified email is required to record a login");

  return {
    name: textValue(input.name) || email.split("@")[0],
    email,
  };
}

const isoTimestamp = (value) => new Date(value).toISOString();
const serializeUser = (row) => ({
  name: row.name,
  email: row.email,
  first_login: isoTimestamp(row.first_login),
  last_login: isoTimestamp(row.last_login),
  last_active_at: isoTimestamp(row.last_active_at),
});

export async function upsertUserLogin(sql, input, now = new Date()) {
  const user = normalizeLoginIdentity(input);
  const loginTime = isoTimestamp(now);
  const [row] = await sql`
    INSERT INTO users (name, email, first_login, last_login, last_active_at)
    VALUES (${user.name}, ${user.email}, ${loginTime}, ${loginTime}, ${loginTime})
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      last_login = EXCLUDED.last_login,
      last_active_at = EXCLUDED.last_active_at
    RETURNING name, email, first_login, last_login, last_active_at
  `;
  return serializeUser(row);
}

export async function upsertUserActivity(sql, input, now = new Date()) {
  const user = normalizeLoginIdentity(input);
  const activityTime = isoTimestamp(now);
  const [row] = await sql`
    INSERT INTO users (name, email, first_login, last_login, last_active_at)
    VALUES (${user.name}, ${user.email}, ${activityTime}, ${activityTime}, ${activityTime})
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      last_active_at = EXCLUDED.last_active_at
    WHERE users.last_active_at <= EXCLUDED.last_active_at
      - (${USER_ACTIVITY_WRITE_INTERVAL_MS} * INTERVAL '1 millisecond')
    RETURNING name, email, first_login, last_login, last_active_at
  `;
  return row ? serializeUser(row) : null;
}

export async function backfillExistingContributorLogins(sql) {
  const rows = await sql`
    INSERT INTO users (name, email, first_login, last_login, last_active_at)
    SELECT
      COALESCE(
        (ARRAY_AGG(NULLIF(TRIM(author_name), '') ORDER BY created_at DESC)
          FILTER (WHERE NULLIF(TRIM(author_name), '') IS NOT NULL))[1],
        SPLIT_PART(LOWER(TRIM(author_email)), '@', 1)
      ) AS name,
      LOWER(TRIM(author_email)) AS email,
      MIN(created_at) AS first_login,
      MAX(created_at) AS last_login,
      MAX(created_at) AS last_active_at
    FROM suggestions
    WHERE NULLIF(TRIM(author_email), '') IS NOT NULL
    GROUP BY LOWER(TRIM(author_email))
    ON CONFLICT (email) DO UPDATE SET
      first_login = LEAST(users.first_login, EXCLUDED.first_login),
      last_login = GREATEST(users.last_login, EXCLUDED.last_login),
      last_active_at = GREATEST(users.last_active_at, EXCLUDED.last_active_at)
    RETURNING 1 AS synced
  `;
  return rows.length;
}

export async function listUserActivity(sql) {
  const rows = await sql`
    SELECT name, email, first_login, last_login, last_active_at
    FROM users
    ORDER BY last_active_at DESC, email ASC
  `;
  return rows.map(serializeUser);
}
