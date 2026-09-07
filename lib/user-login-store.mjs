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
const displayNameFrom = (row) => textValue(row.display_name) || textValue(row.name);
const serializeUser = (row) => ({
  name: displayNameFrom(row),
  displayName: displayNameFrom(row),
  email: row.email,
  role: row.role || "member",
  first_login: isoTimestamp(row.first_login),
  last_login: isoTimestamp(row.last_login),
  last_active_at: isoTimestamp(row.last_active_at),
});

export async function upsertUserLogin(sql, input, now = new Date()) {
  const user = normalizeLoginIdentity(input);
  const loginTime = isoTimestamp(now);
  const [row] = await sql`
    INSERT INTO users (name, display_name, email, first_login, last_login, last_active_at)
    VALUES (${user.name}, ${user.name}, ${user.email}, ${loginTime}, ${loginTime}, ${loginTime})
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      last_login = EXCLUDED.last_login,
      last_active_at = EXCLUDED.last_active_at
    RETURNING name, display_name, email, role, first_login, last_login, last_active_at
  `;
  return serializeUser(row);
}

export async function upsertUserActivity(sql, input, now = new Date()) {
  const user = normalizeLoginIdentity(input);
  const activityTime = isoTimestamp(now);
  const [row] = await sql`
    INSERT INTO users (name, display_name, email, first_login, last_login, last_active_at)
    VALUES (${user.name}, ${user.name}, ${user.email}, ${activityTime}, ${activityTime}, ${activityTime})
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      last_active_at = EXCLUDED.last_active_at
    WHERE users.last_active_at <= EXCLUDED.last_active_at
      - (${USER_ACTIVITY_WRITE_INTERVAL_MS} * INTERVAL '1 millisecond')
    RETURNING name, display_name, email, role, first_login, last_login, last_active_at
  `;
  return row ? serializeUser(row) : null;
}

export async function resolveStoredUserRole(sql, email) {
  const normalizedEmail = textValue(email).toLowerCase();
  if (!normalizedEmail) return "member";
  const [row] = await sql`SELECT role FROM users WHERE email = ${normalizedEmail} LIMIT 1`;
  return row?.role === "admin" ? "admin" : "member";
}

export async function updateStoredUserRole(sql, { email, role, ownerEmail }) {
  const normalizedEmail = textValue(email).toLowerCase();
  const normalizedOwnerEmail = textValue(ownerEmail).toLowerCase();
  if (normalizedEmail === normalizedOwnerEmail) {
    const error = new Error("Không thể thay đổi quyền của owner cố định");
    error.code = "USER_ROLE_OWNER_IMMUTABLE";
    throw error;
  }
  const [row] = await sql`
    UPDATE users
    SET role = ${role}
    WHERE email = ${normalizedEmail}
    RETURNING name, display_name, email, role, first_login, last_login, last_active_at
  `;
  if (!row) {
    const error = new Error("Không tìm thấy người dùng");
    error.code = "USER_NOT_FOUND";
    throw error;
  }
  return serializeUser(row);
}

export async function updateStoredUserDisplayName(sql, { email, displayName }) {
  const normalizedEmail = textValue(email).toLowerCase();
  const normalizedDisplayName = textValue(displayName);
  const [userRows] = await sql.transaction((tx) => [
    tx`
      UPDATE users
      SET display_name = ${normalizedDisplayName}
      WHERE email = ${normalizedEmail}
      RETURNING name, display_name, email, role, first_login, last_login, last_active_at
    `,
    tx`UPDATE suggestions SET author_name = ${normalizedDisplayName} WHERE LOWER(author_email) = ${normalizedEmail}`,
    tx`UPDATE notifications notification
      SET actor_name = ${normalizedDisplayName}
      FROM suggestions suggestion
      WHERE notification.suggestion_id = suggestion.id
        AND LOWER(suggestion.author_email) = ${normalizedEmail}`,
    tx`UPDATE admin_notification_outbox outbox
      SET author_name = ${normalizedDisplayName}
      FROM suggestions suggestion
      WHERE outbox.suggestion_id = suggestion.id
        AND LOWER(suggestion.author_email) = ${normalizedEmail}`,
  ]);
  const [row] = userRows;
  if (!row) {
    const error = new Error("Không tìm thấy người dùng");
    error.code = "USER_NOT_FOUND";
    throw error;
  }
  return serializeUser(row);
}

export async function resolveStoredUser(sql, email) {
  const normalizedEmail = textValue(email).toLowerCase();
  if (!normalizedEmail) return null;
  const [row] = await sql`
    SELECT name, display_name, email, role, first_login, last_login, last_active_at
    FROM users
    WHERE email = ${normalizedEmail}
    LIMIT 1
  `;
  return row ? serializeUser(row) : null;
}

export async function listUserActivity(sql, { ownerEmail = "" } = {}) {
  const rows = await sql`
    SELECT name, display_name, email, role, first_login, last_login, last_active_at
    FROM users
    ORDER BY last_active_at DESC, email ASC
  `;
  const normalizedOwnerEmail = textValue(ownerEmail).toLowerCase();
  return rows.map((row) => ({
    ...serializeUser(row),
    role: row.email.toLowerCase() === normalizedOwnerEmail ? "owner" : (row.role || "member"),
  }));
}
