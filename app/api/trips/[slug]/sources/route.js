import { NextResponse } from "next/server";
import { apiError } from "../../../../../lib/api-response";
import { getViewer } from "../../../../../lib/auth";
import { createSource } from "../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../lib/trip-cache";
import { parseSourceInput, readJsonBody } from "../../../../../lib/validation";
import { requireTripAccess } from "../../../../../lib/trip-access-repository";
import { recordTripAudit } from "../../../../../lib/trip-audit-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, context) {
  const { slug } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug, "manage");
    const input = parseSourceInput(await readJsonBody(request));
    const source = await createSource(slug, input);
    await recordTripAudit(slug, viewer, { action: "source.created", entityType: "source", entityId: source.number, after: source });
    expireTravelPlansCache();
    return NextResponse.json(source, { status: 201 });
  } catch (error) { return apiError(error); }
}
