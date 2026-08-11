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
});

export async function upsertUserLogin(sql, input, now = new Date()) {
  const user = normalizeLoginIdentity(input);
  const loginTime = isoTimestamp(now);
  const [row] = await sql`
    INSERT INTO users (name, email, first_login, last_login)
    VALUES (${user.name}, ${user.email}, ${loginTime}, ${loginTime})
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      last_login = EXCLUDED.last_login
    RETURNING name, email, first_login, last_login
  `;
  return serializeUser(row);
}

export async function backfillExistingContributorLogins(sql) {
  const rows = await sql`
    INSERT INTO users (name, email, first_login, last_login)
    SELECT
      COALESCE(
        (ARRAY_AGG(NULLIF(TRIM(author_name), '') ORDER BY created_at DESC)
          FILTER (WHERE NULLIF(TRIM(author_name), '') IS NOT NULL))[1],
        SPLIT_PART(LOWER(TRIM(author_email)), '@', 1)
      ) AS name,
      LOWER(TRIM(author_email)) AS email,
      MIN(created_at) AS first_login,
      MAX(created_at) AS last_login
    FROM suggestions
    WHERE NULLIF(TRIM(author_email), '') IS NOT NULL
    GROUP BY LOWER(TRIM(author_email))
    ON CONFLICT (email) DO UPDATE SET
      first_login = LEAST(users.first_login, EXCLUDED.first_login),
      last_login = GREATEST(users.last_login, EXCLUDED.last_login)
    RETURNING 1 AS synced
  `;
  return rows.length;
}

export async function listUserLogins(sql) {
  const rows = await sql`
    SELECT name, email, first_login, last_login
    FROM users
    ORDER BY last_login DESC, email ASC
  `;
  return rows.map(serializeUser);
}
