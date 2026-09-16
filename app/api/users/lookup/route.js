import { NextResponse } from "next/server";
import { apiError } from "../../../../lib/api-response";
import { getViewer } from "../../../../lib/auth";
import { lookupRegisteredUser } from "../../../../lib/trip-access-repository";
import { parseUserLookup, readJsonBody } from "../../../../lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const viewer = await getViewer();
  try {
    const { email } = parseUserLookup(await readJsonBody(request));
    return NextResponse.json(await lookupRegisteredUser(viewer, email));
  } catch (error) { return apiError(error); }
}

