import { createPlaceCollectionRepository } from "../../../../../../../lib/place-collections/repository.mjs";
import { collectionError, collectionJson, collectionMutation, requireCollectionActor } from "../../../../../../../lib/place-collections/http.mjs";
import { AssistantFault } from "../../../../../../../lib/v1/errors.mjs";

export const runtime = "nodejs";
export async function POST(request, { params }) {
  try { collectionMutation(request); const actor = await requireCollectionActor(); const { id } = await params; const body = await collectionJson(request, ["digest"]);
    if (!/^[0-9a-f]{64}$/.test(body.digest || "")) throw new AssistantFault("INVALID_INPUT", "Invalid digest", { status: 400 });
    return Response.json(await createPlaceCollectionRepository().applyPreview(id, actor.email, body.digest));
  } catch (error) { return collectionError(error); }
}
