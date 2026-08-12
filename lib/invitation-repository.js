import "server-only";

import { getSql } from "./db";
import {
  claimInvitationDeliveries,
  listInvitationDeliveries,
  listInvitationDeliveriesByInviter,
  recordInvitationDeliveries,
} from "./invitation-history-store.mjs";

export function listInvitationHistory() {
  return listInvitationDeliveries(getSql());
}

export function listPersonalInvitationHistory(input) {
  return listInvitationDeliveriesByInviter(getSql(), input);
}

export function saveInvitationDeliveries(input) {
  return recordInvitationDeliveries(getSql(), input);
}

export function claimInvitationRecipients(input) {
  return claimInvitationDeliveries(getSql(), input);
}
