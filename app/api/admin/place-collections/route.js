import { createPlaceCollectionRepository } from "../../../../lib/place-collections/repository.mjs";
import { collectionError, requireCollectionActor } from "../../../../lib/place-collections/http.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try { await requireCollectionActor(); return Response.json({ collections: await createPlaceCollectionRepository().list() }); }
  catch (error) { return collectionError(error); }
}
