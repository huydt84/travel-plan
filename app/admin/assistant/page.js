import { notFound } from "next/navigation";
import { getViewer } from "../../../lib/auth";
import { createAssistantManagement } from "../../../lib/v1/assistant-management.mjs";
import AssistantManagementApp from "../../../components/AssistantManagementApp";
export const dynamic = "force-dynamic";
export const metadata = { title: "Quản lý trợ lý" };
export default async function AssistantManagementPage() {
  const viewer = await getViewer();
  if (!viewer?.isOwner) notFound();
  return <AssistantManagementApp viewer={viewer} initial={await createAssistantManagement().overview()} />;
}
