import { getViewer } from "../auth.js";
import { AssistantFault } from "../v1/errors.mjs";
import { assertSameOrigin, assistantErrorResponse } from "../v1/http.mjs";
import { collectionFault } from "./repository.mjs";

export async function requireCollectionActor() {
  const viewer = await getViewer();
  if (!viewer) throw new AssistantFault("UNAUTHENTICATED", "You need to sign in with Google", { status: 401 });
  if (!viewer.isAdmin) throw new AssistantFault("COLLECTION_FORBIDDEN", "Only owners and admins can manage collections", { status: 403 });
  return viewer;
}

export function collectionMutation(request) { assertSameOrigin(request); }
export function collectionError(error) { return assistantErrorResponse(collectionFault(error)); }
export async function collectionJson(request, allowedKeys) {
  let body;
  try { body = await request.json(); } catch { throw new AssistantFault("INVALID_INPUT", "Request body must be valid JSON", { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !allowedKeys.includes(key)))
    throw new AssistantFault("INVALID_INPUT", "Request body contains unsupported fields", { status: 400 });
  return body;
}
