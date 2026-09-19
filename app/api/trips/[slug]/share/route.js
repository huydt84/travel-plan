import { NextResponse } from "next/server";
import { apiError } from "../../../../../lib/api-response";
import { getViewer } from "../../../../../lib/auth";
import { requireTripAccess } from "../../../../../lib/trip-access-repository";
import { createTripShareLink } from "../../../../../lib/trip-share-repository";

export const runtime = "nodejs";

export async function POST(_request, context) {
  const { slug } = await context.params;
  try {
    const viewer = await getViewer();
    const access = await requireTripAccess(viewer, slug, "manage");
    const { token, expiresAt } = await createTripShareLink(access.trip.id, viewer.email);
    return NextResponse.json({ path: `/share/${token}`, expiresAt }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
