import { after, NextResponse } from "next/server";
import { apiError } from "../../../../../lib/api-response";
import { processAdminNotificationOutbox } from "../../../../../lib/admin-notification-outbox";
import { getViewer, requireAuthenticated } from "../../../../../lib/auth";
import { createSuggestion, listSuggestions } from "../../../../../lib/suggestion-repository";
import { parseSuggestionInput, readJsonBody } from "../../../../../lib/validation";
import { requireTripAccess } from "../../../../../lib/trip-access-repository";
import { recordTripAudit } from "../../../../../lib/trip-audit-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request, context) {
  const { slug } = await context.params;
  try {
    const viewer = await getViewer();
    const access = await requireTripAccess(viewer, slug);
    return NextResponse.json({ suggestions: await listSuggestions(slug, { ...viewer, canManageTrip: access.canManage }) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request, context) {
  const { viewer, response } = await requireAuthenticated();
  if (response) return response;
  const { slug } = await context.params;
  try {
    const access = await requireTripAccess(viewer, slug);
    const input = parseSuggestionInput(await readJsonBody(request));
    const result = await createSuggestion(slug, input, { ...viewer, canManageTrip: access.canManage });
    await recordTripAudit(slug, viewer, { action: "suggestion.created", entityType: "suggestion", entityId: result.suggestion.id, after: { kind: result.suggestion.kind, status: result.suggestion.status } });
    if (result.adminOutboxId) {
      after(() => processAdminNotificationOutbox({ outboxId: result.adminOutboxId }));
    }
    return NextResponse.json(result.suggestion, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
