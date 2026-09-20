import { NextResponse } from "next/server";
import { apiError } from "../../../../../lib/api-response";
import { getViewer } from "../../../../../lib/auth";
import { requireTripAccess } from "../../../../../lib/trip-access-repository";
import { createTripShareLink } from "../../../../../lib/trip-share-repository";
import { readJsonBody, ValidationError } from "../../../../../lib/validation";

export const runtime = "nodejs";

export async function POST(request, context) {
  const { slug } = await context.params;
  try {
    const viewer = await getViewer();
    const access = await requireTripAccess(viewer, slug, "manage");
    const body = request.headers.has("content-type") ? await readJsonBody(request) : {};
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Request body must be an object");
    const { minutes = 10 } = body;
    const { token, expiresAt } = await createTripShareLink(access.trip.id, viewer.email, minutes);
    return NextResponse.json({ path: `/share/${token}`, expiresAt }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
