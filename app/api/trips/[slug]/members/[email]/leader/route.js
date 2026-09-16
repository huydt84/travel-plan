import { NextResponse } from "next/server";
import { apiError } from "../../../../../../../lib/api-response";
import { getViewer } from "../../../../../../../lib/auth";
import { transferTripLeadership } from "../../../../../../../lib/trip-access-repository";

export const dynamic = "force-dynamic";

export async function PUT(_request, context) {
  const viewer = await getViewer();
  const { slug, email } = await context.params;
  try {
    await transferTripLeadership(viewer, slug, decodeURIComponent(email));
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}

