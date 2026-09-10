import { createPlaceCollectionRepository } from "../../../../../../lib/place-collections/repository.mjs";
import { collectionError, requireCollectionActor } from "../../../../../../lib/place-collections/http.mjs";

export const dynamic = "force-dynamic";
export async function GET(request, { params }) {
  try { const actor = await requireCollectionActor(); const { id } = await params; const url = new URL(request.url);
    return Response.json(await createPlaceCollectionRepository().getPreview(id, actor.email, { offset: Number(url.searchParams.get("cursor") || 0), change: url.searchParams.get("change") || null }));
  } catch (error) { return collectionError(error); }
}
