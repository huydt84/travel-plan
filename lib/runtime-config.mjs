const LOCAL_ADMIN_ENABLED = "true";
export const DEFAULT_LOCAL_POSTGRES_URI = "postgresql://travel:travel@127.0.0.1:55432/travel_local";

const value = (input) => typeof input === "string" ? input.trim() : "";
const parseDatabaseUrl = (databaseUrl, variableName) => {
  try {
    const parsed = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("unsupported protocol");
    return parsed;
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL connection URL`);
  }
};
const databaseTarget = (databaseUrl) => {
  try {
    const parsed = new URL(databaseUrl);
    return `${parsed.hostname.toLowerCase()}${parsed.pathname}`;
  } catch {
    return databaseUrl;
  }
};

export function resolveLocalAdminMode(env = process.env) {
  if (value(env.LOCAL_ADMIN_BYPASS) !== LOCAL_ADMIN_ENABLED) {
    return { enabled: false, databaseUrl: null };
  }

  if (env.NODE_ENV !== "development") {
    throw new Error("LOCAL_ADMIN_BYPASS is only allowed with NODE_ENV=development");
  }

  const databaseUrl = value(env.LOCAL_POSTGRES_URI) || DEFAULT_LOCAL_POSTGRES_URI;
  const parsed = parseDatabaseUrl(databaseUrl, "LOCAL_POSTGRES_URI");
  const hostname = parsed.hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    throw new Error("LOCAL_POSTGRES_URI must target PostgreSQL on localhost or a loopback address");
  }

  const normalDatabaseUrl = value(env.POSTGRES_URI);
  if (normalDatabaseUrl && databaseTarget(databaseUrl) === databaseTarget(normalDatabaseUrl)) {
    throw new Error("LOCAL_POSTGRES_URI must target a different database or Neon branch than POSTGRES_URI");
  }

  return { enabled: true, databaseUrl, driver: "postgres-tcp" };
}

export function resolveDatabaseConfig(env = process.env) {
  const localAdmin = resolveLocalAdminMode(env);
  if (localAdmin.enabled) return { databaseUrl: localAdmin.databaseUrl, driver: localAdmin.driver };

  const databaseUrl = value(env.POSTGRES_URI);
  if (!databaseUrl) throw new Error("POSTGRES_URI is not configured");
  return { databaseUrl, driver: "neon-http" };
}

export function resolveDatabaseUrl(env = process.env) {
  return resolveDatabaseConfig(env).databaseUrl;
}

export function resolveLocalAdminViewer(env = process.env) {
  const localAdmin = resolveLocalAdminMode(env);
  if (!localAdmin.enabled) return null;

  const email = value(env.LOCAL_VIEWER_EMAIL).toLowerCase() || "local-admin@localhost.invalid";

  return {
    email,
    name: value(env.LOCAL_VIEWER_NAME) || (email === "local-admin@localhost.invalid" ? "Local Admin" : email.split("@")[0]),
    image: null,
    isOwner: email === "local-admin@localhost.invalid",
    isAdmin: email === "local-admin@localhost.invalid",
    role: email === "local-admin@localhost.invalid" ? "owner" : "member",
    authMode: "local-dev",
  };
}
