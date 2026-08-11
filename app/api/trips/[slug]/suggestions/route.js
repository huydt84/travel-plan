import { NextResponse } from "next/server";
import { apiError } from "../../../../../lib/api-response";
import { getViewer, requireAuthenticated } from "../../../../../lib/auth";
import { createSuggestion, listSuggestions } from "../../../../../lib/suggestion-repository";
import { parseSuggestionInput, readJsonBody } from "../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request, context) {
  const { slug } = await context.params;
  try {
    return NextResponse.json({ suggestions: await listSuggestions(slug, await getViewer()) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request, context) {
  const { viewer, response } = await requireAuthenticated();
  if (response) return response;
  const { slug } = await context.params;
  try {
    const input = parseSuggestionInput(await readJsonBody(request));
    return NextResponse.json(await createSuggestion(slug, input, viewer), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
