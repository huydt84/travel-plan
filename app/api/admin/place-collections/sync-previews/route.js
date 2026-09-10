import { createPlaceCollectionRepository } from "../../../../../lib/place-collections/repository.mjs";
import { collectionError, collectionJson, collectionMutation, requireCollectionActor } from "../../../../../lib/place-collections/http.mjs";
import { AssistantFault } from "../../../../../lib/v1/errors.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request) {
  try { collectionMutation(request); const actor = await requireCollectionActor(); const body = await collectionJson(request, ["url","collectionId"]);
    if (body.url !== undefined && (typeof body.url !== "string" || body.url.length > 2048)) throw new AssistantFault("INVALID_INPUT", "Invalid URL", { status: 400 });
    return Response.json(await createPlaceCollectionRepository().createPreview({ actor, url: body.url, collectionId: body.collectionId, signal: request.signal }), { status: 201 });
  } catch (error) { return collectionError(error); }
}
