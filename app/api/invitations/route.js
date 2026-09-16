import { createInvitationHandler } from "../../../lib/invitation-handler.mjs";
import { requireAuthenticated } from "../../../lib/auth";
import { getGoogleMailAccess } from "../../../lib/google-mail-auth.mjs";
import {
  sendInvitationBatch,
} from "../../../lib/invitation-email.mjs";
import {
  claimInvitationRecipients,
  saveInvitationDeliveries,
} from "../../../lib/invitation-repository";
import {
  reserveInvitationBatch,
  resolveInvitationPermission,
} from "../../../lib/invitation-permission-repository";
import { getCachedItinerary } from "../../../lib/trip-cache";
import { assertTripMemberEmails } from "../../../lib/trip-access-repository";
import { recordTripAudit } from "../../../lib/trip-audit-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createInvitationHandler({
  requireAuthenticated, resolveInvitationPermission, getGoogleMailAccess, getCachedItinerary,
  reserveInvitationBatch, claimInvitationRecipients, sendInvitationBatch, saveInvitationDeliveries,
  assertTripMemberEmails, recordTripAudit,
});
