import { NextResponse } from "next/server";
import { apiError } from "../../../../../../../lib/api-response";
import { getViewer } from "../../../../../../../lib/auth";
import { setExpensePermission } from "../../../../../../../lib/trip-access-repository";
import { parseExpensePermission, readJsonBody } from "../../../../../../../lib/validation";

export const dynamic = "force-dynamic";

export async function PUT(request, context) {
  const viewer = await getViewer();
  const { slug, email } = await context.params;
  try {
    const { canManageExpenses } = parseExpensePermission(await readJsonBody(request));
    return NextResponse.json(await setExpensePermission(viewer, slug, decodeURIComponent(email), canManageExpenses));
  } catch (error) { return apiError(error); }
}
