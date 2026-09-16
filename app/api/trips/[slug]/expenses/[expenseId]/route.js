import { NextResponse } from "next/server";
import { apiError } from "../../../../../../lib/api-response";
import { getViewer } from "../../../../../../lib/auth";
import { deleteExpense, updateExpense } from "../../../../../../lib/expense-repository";
import { requireTripAccess } from "../../../../../../lib/trip-access-repository";
import { parseExpenseInput, readJsonBody, ValidationError } from "../../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idFrom = (value) => {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new ValidationError("expenseId must be a positive integer");
  return value;
};

export async function PATCH(request, context) {
  const { slug, expenseId } = await context.params;
  const viewer = await getViewer();
  try {
    const access = await requireTripAccess(viewer, slug, "manageExpenses");
    const input = parseExpenseInput(await readJsonBody(request), access.trip.currency, { partial: true });
    return NextResponse.json(await updateExpense(viewer, slug, idFrom(expenseId), input));
  } catch (error) { return apiError(error); }
}

export async function DELETE(_request, context) {
  const { slug, expenseId } = await context.params;
  const viewer = await getViewer();
  try {
    await deleteExpense(viewer, slug, idFrom(expenseId));
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}
