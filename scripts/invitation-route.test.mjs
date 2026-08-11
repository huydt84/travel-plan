import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSource = await readFile(new URL("../app/api/invitations/route.js", import.meta.url), "utf8");

test("invitation route is owner-only and validates before sending", () => {
  assert.match(routeSource, /await requireOwner\(\)/);
  assert.match(routeSource, /parseInvitationInput\(await readJsonBody\(request\)\)/);
  assert.match(routeSource, /getGoogleMailAccess\(request\)/);
  assert.match(routeSource, /getCachedItinerary\(input\.tripSlug\)/);
  assert.match(routeSource, /trip: plan\.trip/);
  assert.match(routeSource, /sendInvitationBatch/);
  assert.match(routeSource, /status: 201/);
});

test("invitation route maps validation, Gmail authorization, configuration, and delivery failures", () => {
  assert.match(routeSource, /status: 400/);
  assert.match(routeSource, /INVITATION_AUTH_ERROR/);
  assert.match(routeSource, /đăng xuất rồi đăng nhập lại/);
  assert.match(routeSource, /status: 403/);
  assert.match(routeSource, /INVITATION_CONFIG_ERROR/);
  assert.match(routeSource, /status: 503/);
  assert.match(routeSource, /INVITATION_DELIVERY_ERROR/);
  assert.match(routeSource, /status: 502/);
  assert.match(routeSource, /TRIP_NOT_FOUND/);
  assert.match(routeSource, /status: 404/);
});
