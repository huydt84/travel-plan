import { NextResponse } from "next/server";
import { apiError } from "../../../../../../lib/api-response";
import { requireAuthenticated } from "../../../../../../lib/auth";
import {
  deleteSuggestion,
  updateSuggestionStatus,
  updateSuggestionVisibility,
} from "../../../../../../lib/suggestion-repository";
import { parseSuggestionMutation, readJsonBody, ValidationError } from "../../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idFrom = (value) => {
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw new ValidationError("suggestionId must be a positive integer");
  return value;
};

export async function PATCH(request, context) {
  const { viewer, response } = await requireAuthenticated();
  if (response) return response;
  const { slug, suggestionId } = await context.params;
  try {
    const mutation = parseSuggestionMutation(await readJsonBody(request));
    const updated = Object.prototype.hasOwnProperty.call(mutation, "status")
      ? await updateSuggestionStatus(slug, idFrom(suggestionId), mutation.status, viewer)
      : await updateSuggestionVisibility(slug, idFrom(suggestionId), mutation.hidden, viewer);
    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request, context) {
  const { viewer, response } = await requireAuthenticated();
  if (response) return response;
  const { slug, suggestionId } = await context.params;
  try {
    await deleteSuggestion(slug, idFrom(suggestionId), viewer);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
