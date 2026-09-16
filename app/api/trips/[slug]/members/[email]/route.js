import { apiError } from "../../../../../../lib/api-response";
import { getViewer } from "../../../../../../lib/auth";
import { removeTripMember } from "../../../../../../lib/trip-access-repository";

export const dynamic = "force-dynamic";

export async function DELETE(_request, context) {
  const viewer = await getViewer();
  const { slug, email } = await context.params;
  try {
    await removeTripMember(viewer, slug, decodeURIComponent(email));
    return new Response(null, { status: 204 });
  } catch (error) { return apiError(error); }
}

