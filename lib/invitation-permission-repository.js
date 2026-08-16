import "server-only";

import { getSql } from "./db";
import {
  claimInvitationBatch,
  countPendingInvitationPermissions,
  getInvitationPermission,
  getInvitationQuota,
  listInvitationPermissions,
  requestInvitationPermission,
  reviewInvitationPermission,
} from "./invitation-permission-store.mjs";

export const implicitOwnerPermission = (viewer) => ({
  id: null,
  userEmail: viewer.email,
  userName: viewer.name,
  status: "approved",
  requestedTripSlug: null,
  requestedTripTitle: null,
  requestedAt: null,
  reviewedAt: null,
  reviewedBy: viewer.email,
  decisionReason: "",
  updatedAt: null,
});

export async function resolveInvitationPermission(viewer) {
  if (!viewer) return null;
  if (viewer.isAdmin) return implicitOwnerPermission(viewer);
  return getInvitationPermission(getSql(), viewer.email);
}

export function createInvitationPermissionRequest(input) {
  return requestInvitationPermission(getSql(), input);
}

export function listAllInvitationPermissions() {
  return listInvitationPermissions(getSql());
}

export function countPendingInvitationRequests() {
  return countPendingInvitationPermissions(getSql());
}

export function updateInvitationPermission(input) {
  return reviewInvitationPermission(getSql(), input);
}

export function readInvitationQuota(inviterEmail) {
  return getInvitationQuota(getSql(), inviterEmail);
}

export function reserveInvitationBatch(input) {
  return claimInvitationBatch(getSql(), input);
}
