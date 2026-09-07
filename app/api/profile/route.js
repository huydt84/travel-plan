import { NextResponse } from "next/server";
import { apiError } from "../../../lib/api-response";
import { requireAuthenticated } from "../../../lib/auth";
import { updateUserDisplayName } from "../../../lib/user-repository";
import { parseDisplayName, readJsonBody } from "../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request) {
  const { viewer, response } = await requireAuthenticated();
  if (response) return response;
  try {
    const { displayName } = parseDisplayName(await readJsonBody(request));
    return NextResponse.json(await updateUserDisplayName({ email: viewer.email, displayName }));
  } catch (error) {
    return apiError(error);
  }
}
