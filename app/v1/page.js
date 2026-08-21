import { notFound } from "next/navigation";
import { getViewer } from "../../lib/auth";
import { resolveAgenticV1Config } from "../../lib/v1/config.mjs";
import { getDefaultTravelAssistant } from "../../lib/v1/travel-assistant.mjs";
import AssistantAccess from "../../components/v1/AssistantAccess";
import AssistantWorkspace from "../../components/v1/AssistantWorkspace";

export const metadata = { title: "Trợ lý hành trình · v1" };
export const dynamic = "force-dynamic";

export default async function AgenticTravelPage() {
  if (!resolveAgenticV1Config().enabled) notFound();
  const viewer = await getViewer();
  if (!viewer?.email || !viewer.isAdmin) return <AssistantAccess viewer={viewer} />;

  const workspace = await getDefaultTravelAssistant().loadWorkspace({ actor: viewer });
  return <AssistantWorkspace initialWorkspace={workspace} viewer={viewer} />;
}
