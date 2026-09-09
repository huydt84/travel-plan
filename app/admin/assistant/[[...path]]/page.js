import { notFound } from "next/navigation";
import { getViewer } from "../../../../lib/auth";
import { createAssistantManagement } from "../../../../lib/v1/assistant-management.mjs";
import { validateSchema, workspaceQuerySchema } from "../../../../lib/v1/schemas.mjs";
import AssistantManagementApp from "../../../../components/AssistantManagementApp";
import { localizedMetadata } from "../../../../lib/locale-server";
export const dynamic = "force-dynamic";
export const generateMetadata = () => localizedMetadata("nav.adminAssistant");
export default async function AssistantManagementPage({params,searchParams}) {
  const viewer = await getViewer();
  if (!viewer?.isOwner) notFound();
  const {path=[]} = await params, query = await searchParams;
  const service = createAssistantManagement();
  const initial = await service.overview();
  const view = {kind:"overview",page:Number(query.page || 1),edit:query.edit === "1",saved:query.saved === "1"};
  if (!Number.isSafeInteger(view.page) || view.page<1 || view.page>100000) notFound();
  const uuid = value => { try { validateSchema(workspaceQuerySchema.properties.conversationId,value); } catch { notFound(); } };
  try {
    if (path.length===1 && path[0]==="settings") view.kind="settings";
    else if (path[0]==="handoffs" && path.length===2) { uuid(path[1]); view.kind="handoff"; view.handoff=await service.handoff(path[1]); }
    else if (path[0]==="users" && (path.length===2 || path.length===3 && path[2]==="conversations")) {
      try {view.email=decodeURIComponent(path[1]);} catch {notFound();} view.person=initial.admins.find(p=>p.email===view.email);
      if (!view.person && view.email!==viewer.email) notFound();
      view.kind=path.length===3 ? "history" : "user";
      if (view.kind==="user" && !view.person) notFound();
      if (view.kind==="history") view.history=await service.conversations(view.email,await service.pageCursor("history",view.email,view.page));
    } else if (path[0]==="conversations" && (path.length===2 || path.length===4 && path[2]==="turns")) {
      uuid(path[1]); view.kind=path.length===4 ? "request" : "conversation";
      if (view.kind==="request") { uuid(path[3]); view.review=await service.request(path[1],path[3]); }
      else {
        if(query.target) { uuid(query.target); view.target=query.target; view.page=await service.targetPage(path[1],query.target); }
        view.review=await service.conversation(path[1],await service.pageCursor("conversation",path[1],view.page));
      }
    } else if(path[0]==="failures" && path.length<=2) {
      view.kind=path.length===2 ? "failure" : "failures";
      if(view.kind==="failure") {uuid(path[1]);view.failure=await service.failure(path[1]);}
      else view.failures=await service.failures(await service.pageCursor("failures",null,view.page));
    } else if(path.length) notFound();
  } catch(error) { if(error.status===404) notFound(); throw error; }
  return <AssistantManagementApp key={JSON.stringify([path,query])} viewer={viewer} initial={initial} view={view} />;
}
