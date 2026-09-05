import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_ROUTES } from "../lib/admin-routes.mjs";

test("admin management screens are siblings with no compatibility gateway", () => {
  assert.deepEqual(ADMIN_ROUTES, {
    trips: "/admin/trips",
    requests: "/admin/requests",
    invitations: "/admin/invitations",
    users: "/admin/users",
  });
});
