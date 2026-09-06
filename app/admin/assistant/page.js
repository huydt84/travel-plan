import { notFound } from "next/navigation";
import { getViewer } from "../../../lib/auth";
import { createAssistantManagement } from "../../../lib/v1/assistant-management.mjs";
import AssistantManagementApp from "../../../components/AssistantManagementApp";
export const dynamic = "force-dynamic";
import { localizedMetadata } from "../../../lib/locale-server";
export const generateMetadata = () => localizedMetadata("nav.adminAssistant");
export default async function AssistantManagementPage() {
  const viewer = await getViewer();
  if (!viewer?.isOwner) notFound();
  return <AssistantManagementApp viewer={viewer} initial={await createAssistantManagement().overview()} />;
}
