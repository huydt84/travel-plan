import { NextResponse } from "next/server";
import { apiError } from "../../../../../lib/api-response";
import { getViewer } from "../../../../../lib/auth";
import { addTripMember, listTripMembers } from "../../../../../lib/trip-access-repository";
import { parseUserLookup, readJsonBody } from "../../../../../lib/validation";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  const viewer = await getViewer();
  const { slug } = await context.params;
  try { return NextResponse.json(await listTripMembers(viewer, slug)); }
  catch (error) { return apiError(error); }
}

export async function POST(request, context) {
  const viewer = await getViewer();
  const { slug } = await context.params;
  try {
    const { email } = parseUserLookup(await readJsonBody(request));
    return NextResponse.json(await addTripMember(viewer, slug, email), { status: 201 });
  } catch (error) { return apiError(error); }
}

