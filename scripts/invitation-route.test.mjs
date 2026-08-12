import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSource = await readFile(new URL("../app/api/invitations/route.js", import.meta.url), "utf8");

test("invitation route requires an approved authenticated sender and validates before sending", () => {
  assert.match(routeSource, /await requireAuthenticated\(\)/);
  assert.match(routeSource, /parseInvitationInput\(await readJsonBody\(request\)\)/);
  assert.match(routeSource, /resolveInvitationPermission\(viewer\)/);
  assert.match(routeSource, /permission\?\.status !== "approved"/);
  assert.match(routeSource, /getGoogleMailAccess\(request\)/);
  assert.match(routeSource, /mailAccess\.email !== viewer\.email/);
  assert.match(routeSource, /getCachedItinerary\(input\.tripSlug\)/);
  assert.match(routeSource, /reserveInvitationBatch/);
  assert.match(routeSource, /trip: plan\.trip/);
  assert.match(routeSource, /sendInvitationBatch/);
  assert.match(routeSource, /saveInvitationDeliveries/);
  assert.match(routeSource, /claimInvitationRecipients/);
  assert.match(routeSource, /recipients: claimedRecipients/);
  assert.match(routeSource, /const skipped = input\.recipients\.length - claimedRecipients\.length/);
  assert.match(routeSource, /deliveries: result\.deliveries/);
  assert.match(routeSource, /history/);
  assert.match(routeSource, /status: 201/);
});

test("invitation route maps validation, Gmail authorization, configuration, and delivery failures", () => {
  assert.match(routeSource, /status: 400/);
  assert.match(routeSource, /INVITATION_AUTH_ERROR/);
  assert.match(routeSource, /GMAIL_AUTH_REQUIRED/);
  assert.match(routeSource, /PERMISSION_REQUIRED/);
  assert.match(routeSource, /PERMISSION_PENDING/);
  assert.match(routeSource, /PERMISSION_DENIED/);
  assert.match(routeSource, /PERMISSION_REVOKED/);
  assert.match(routeSource, /INVITATION_RATE_LIMIT/);
  assert.match(routeSource, /status: 429/);
  assert.match(routeSource, /status: 403/);
  assert.match(routeSource, /INVITATION_CONFIG_ERROR/);
  assert.match(routeSource, /status: 503/);
  assert.match(routeSource, /INVITATION_DELIVERY_ERROR/);
  assert.match(routeSource, /status: 502/);
  assert.match(routeSource, /TRIP_NOT_FOUND/);
  assert.match(routeSource, /status: 404/);
});
