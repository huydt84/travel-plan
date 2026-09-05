// Frozen baseline helpers: do not import evolving application behavior into historical migrations.
export function migrationSql(pgm) {
  return async (strings, ...values) => {
    const text = strings.reduce((query, part, index) => query + (index ? `$${index}` : "") + part, "");
    return (await pgm.db.query(text, values)).rows;
  };
}

export const slugify = (value) => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 100) || "activity";

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

