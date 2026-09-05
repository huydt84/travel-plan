import { notFound } from "next/navigation";
import { getViewer } from "../../lib/auth";
import { resolveAgenticV1Config } from "../../lib/v1/config.mjs";
import { getDefaultTravelAssistant } from "../../lib/v1/travel-assistant.mjs";
import AssistantAccess from "../../components/v1/AssistantAccess";
import AssistantWorkspace from "../../components/v1/AssistantWorkspace";

export const metadata = { title: "Trợ lý hành trình" };
export const dynamic = "force-dynamic";

export default async function AgenticTravelPage({ searchParams }) {
  if (!resolveAgenticV1Config().enabled) notFound();
  const viewer = await getViewer();
  if (!viewer?.email || !viewer.isAdmin) return <AssistantAccess viewer={viewer} />;

  const params = await searchParams;
  const workspace = await getDefaultTravelAssistant().loadWorkspace({ actor: viewer, tripSlug: typeof params.trip === "string" ? params.trip : null, conversationId: typeof params.conversation === "string" ? params.conversation : null });
  return <AssistantWorkspace initialWorkspace={workspace} viewer={viewer} />;
}
