import TripRequestApp from "../../components/TripRequestApp";
import { getViewer } from "../../lib/auth";
import { listOwnTripRequests } from "../../lib/trip-request-repository";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, normalizeLocale, translate } from "../../lib/i18n.mjs";

export async function generateMetadata() {
  const locale = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return { title: translate(locale, "requests.title") };
}
export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const viewer = await getViewer();
  const requests = viewer ? await listOwnTripRequests(viewer.email) : [];
  return <TripRequestApp viewer={viewer} initialRequests={requests} />;
}
