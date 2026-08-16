import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LOCAL_POSTGRES_URI,
  resolveDatabaseConfig,
  resolveDatabaseUrl,
  resolveLocalAdminMode,
  resolveLocalAdminViewer,
} from "../lib/runtime-config.mjs";

test("keeps local admin disabled by default and uses the normal database", () => {
  const env = { NODE_ENV: "development", POSTGRES_URI: "postgresql://production.example/travel" };

  assert.deepEqual(resolveLocalAdminMode(env), { enabled: false, databaseUrl: null });
  assert.equal(resolveLocalAdminViewer(env), null);
  assert.equal(resolveDatabaseUrl(env), env.POSTGRES_URI);
  assert.deepEqual(resolveDatabaseConfig(env), { databaseUrl: env.POSTGRES_URI, driver: "neon-http" });
});

test("local admin returns an owner viewer and exclusively selects the local database", () => {
  const env = {
    NODE_ENV: "development",
    LOCAL_ADMIN_BYPASS: "true",
    LOCAL_POSTGRES_URI: "postgresql://travel:travel@127.0.0.1:55432/travel_local",
    POSTGRES_URI: "postgresql://production.example/travel",
  };

  assert.equal(resolveDatabaseUrl(env), env.LOCAL_POSTGRES_URI);
  assert.deepEqual(resolveDatabaseConfig(env), { databaseUrl: env.LOCAL_POSTGRES_URI, driver: "postgres-tcp" });
  assert.deepEqual(resolveLocalAdminViewer(env), {
    email: "local-admin@localhost.invalid",
    name: "Local Admin",
    image: null,
    isOwner: true,
    isAdmin: true,
    role: "owner",
    authMode: "local-dev",
  });
});

test("local mode can represent a contributor without weakening production auth", () => {
  const viewer = resolveLocalAdminViewer({
    NODE_ENV: "development",
    LOCAL_ADMIN_BYPASS: "true",
    LOCAL_VIEWER_EMAIL: "friend@localhost.invalid",
    LOCAL_VIEWER_NAME: "Local Friend",
  });
  assert.deepEqual(viewer, {
    email: "friend@localhost.invalid",
    name: "Local Friend",
    image: null,
    isOwner: false,
    isAdmin: false,
    role: "member",
    authMode: "local-dev",
  });
  assert.throws(() => resolveLocalAdminViewer({
    NODE_ENV: "production",
    LOCAL_ADMIN_BYPASS: "true",
    LOCAL_VIEWER_EMAIL: "friend@localhost.invalid",
  }), /only allowed with NODE_ENV=development/);
});

test("local admin fails closed outside development", () => {
  const env = {
    NODE_ENV: "production",
    LOCAL_ADMIN_BYPASS: "true",
    LOCAL_POSTGRES_URI: "postgresql://travel:travel@127.0.0.1:55432/travel_local",
    POSTGRES_URI: "postgresql://production.example/travel",
  };

  assert.throws(() => resolveLocalAdminMode(env), /only allowed with NODE_ENV=development/);
  assert.throws(() => resolveLocalAdminViewer(env), /only allowed with NODE_ENV=development/);
  assert.throws(() => resolveDatabaseUrl(env), /only allowed with NODE_ENV=development/);
});

test("local admin defaults to the isolated loopback Docker database", () => {
  const env = {
    NODE_ENV: "development",
    LOCAL_ADMIN_BYPASS: "true",
    POSTGRES_URI: "postgresql://production.example/travel",
  };

  assert.equal(resolveDatabaseUrl(env), DEFAULT_LOCAL_POSTGRES_URI);
  assert.equal(resolveLocalAdminMode(env).driver, "postgres-tcp");
});

test("local admin rejects the normal database even when credentials or query options differ", () => {
  const env = {
    NODE_ENV: "development",
    LOCAL_ADMIN_BYPASS: "true",
    LOCAL_POSTGRES_URI: "postgresql://dev-user:dev-password@127.0.0.1:55432/travel?sslmode=require",
    POSTGRES_URI: "postgresql://prod-user:prod-password@127.0.0.1:55432/travel?sslmode=verify-full",
  };

  assert.throws(() => resolveDatabaseUrl(env), /must target a different database or Neon branch/);
});

test("local admin rejects remote PostgreSQL hosts", () => {
  const env = {
    NODE_ENV: "development",
    LOCAL_ADMIN_BYPASS: "true",
    LOCAL_POSTGRES_URI: "postgresql://travel:travel@remote.example/travel_local",
    POSTGRES_URI: "postgresql://production.example/travel",
  };

  assert.throws(() => resolveDatabaseUrl(env), /localhost or a loopback address/);
});

test("database configuration still fails clearly when no normal URI exists", () => {
  assert.throws(() => resolveDatabaseUrl({ NODE_ENV: "development" }), /POSTGRES_URI is not configured/);
});
