import { NextResponse } from "next/server";
import { apiError } from "../../../../../lib/api-response";
import { getViewer } from "../../../../../lib/auth";
import { createExpense, listExpenses } from "../../../../../lib/expense-repository";
import { requireTripAccess } from "../../../../../lib/trip-access-repository";
import { parseExpenseInput, readJsonBody } from "../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request, context) {
  const { slug } = await context.params;
  const viewer = await getViewer();
  try { return NextResponse.json(await listExpenses(viewer, slug)); }
  catch (error) { return apiError(error); }
}

export async function POST(request, context) {
  const { slug } = await context.params;
  const viewer = await getViewer();
  try {
    const access = await requireTripAccess(viewer, slug, "manageExpenses");
    const input = parseExpenseInput(await readJsonBody(request), access.trip.currency);
    return NextResponse.json(await createExpense(viewer, slug, input), { status: 201 });
  } catch (error) { return apiError(error); }
}
