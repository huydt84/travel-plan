import { createPlaceCollectionRepository } from "../../../../../../../lib/place-collections/repository.mjs";
import { collectionError, collectionJson, collectionMutation, requireCollectionActor } from "../../../../../../../lib/place-collections/http.mjs";

export const runtime = "nodejs";
export async function PATCH(request, { params }) {
  try { collectionMutation(request); await requireCollectionActor(); const { id, placeId } = await params; const body = await collectionJson(request, ["hidden"]);
    return Response.json(await createPlaceCollectionRepository().setPlaceHidden(id, placeId, body.hidden));
  } catch (error) { return collectionError(error); }
}
