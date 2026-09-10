import { createPlaceCollectionRepository } from "../../../../../lib/place-collections/repository.mjs";
import { collectionError, collectionJson, collectionMutation, requireCollectionActor } from "../../../../../lib/place-collections/http.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  try { await requireCollectionActor(); const { id } = await params; const url = new URL(request.url);
    return Response.json(await createPlaceCollectionRepository().get(id, { offset: Number(url.searchParams.get("cursor") || 0), includeRemoved: url.searchParams.get("removed") !== "0" }));
  } catch (error) { return collectionError(error); }
}
export async function PATCH(request, { params }) {
  try { collectionMutation(request); await requireCollectionActor(); const { id } = await params;
    return Response.json(await createPlaceCollectionRepository().update(id, await collectionJson(request, ["displayName","archived"])));
  } catch (error) { return collectionError(error); }
}
export async function DELETE(request, { params }) {
  try { collectionMutation(request); await requireCollectionActor(); const { id } = await params;
    return Response.json(await createPlaceCollectionRepository().update(id, { archived: true }));
  } catch (error) { return collectionError(error); }
}
