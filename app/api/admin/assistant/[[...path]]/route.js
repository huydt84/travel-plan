import { getViewer } from "../../../../../lib/auth";
import { AssistantFault } from "../../../../../lib/v1/errors.mjs";
import { assistantErrorResponse, assertSameOrigin } from "../../../../../lib/v1/http.mjs";
import { createAssistantManagement } from "../../../../../lib/v1/assistant-management.mjs";
import { handoffReplySchema, validateSchema, workspaceQuerySchema } from "../../../../../lib/v1/schemas.mjs";

export const dynamic = "force-dynamic";
async function handle(request, context) {
  try {
    const viewer = await getViewer();
    if (!viewer?.isOwner) throw new AssistantFault("OWNER_REQUIRED", "Chỉ owner mới được quản lý trợ lý.", { status: viewer ? 403 : 401 });
    if (request.method !== "GET") assertSameOrigin(request);
    const { path = [] } = await context.params;
    const service = createAssistantManagement();
    const url = new URL(request.url);
    const cursorValue = url.searchParams.get("cursor");
    let cursor = null;
    if (cursorValue) {
      try { cursor = JSON.parse(cursorValue); } catch { throw new AssistantFault("INVALID_INPUT", "Mốc lịch sử không hợp lệ."); }
      validateSchema(workspaceQuerySchema.properties.cursor, { id: cursor?.id, createdAt: cursor?.createdAt || cursor?.updatedAt });
      if (!Number.isFinite(Date.parse(cursor.createdAt || cursor.updatedAt))) throw new AssistantFault("INVALID_INPUT", "Mốc lịch sử không hợp lệ.");
    }
    let result;
    if (request.method === "GET" && !path.length) result = await service.overview();
    else if (request.method === "GET" && path.join("/") === "handoffs") result = await service.handoffs();
    else if (request.method === "GET" && path[0] === "handoffs" && path.length === 2) {
      validateSchema(workspaceQuerySchema.properties.conversationId,path[1]); result = await service.handoff(path[1]);
    }
    else if (request.method === "GET" && path.join("/") === "failures") result = await service.failures(cursor);
    else if (request.method === "GET" && path[0] === "admins" && path.length === 3 && path[2] === "conversations") result = await service.conversations(path[1],cursor);
    else if (request.method === "GET" && path[0] === "failures" && path.length === 2) {
      validateSchema(workspaceQuerySchema.properties.conversationId,path[1]); result = await service.failure(path[1]);
    } else if (request.method === "GET" && path[0] === "conversations" && path.length === 4 && path[2] === "turns") {
      validateSchema(workspaceQuerySchema.properties.conversationId,path[1]);
      validateSchema(workspaceQuerySchema.properties.conversationId,path[3]); result = await service.request(path[1],path[3]);
    } else if (request.method === "GET" && path[0] === "conversations" && path.length === 2) {
      validateSchema(workspaceQuerySchema.properties.conversationId,path[1]); const target = url.searchParams.get("target");
      if (target) validateSchema(workspaceQuerySchema.properties.conversationId,target);
      result = await service.conversation(path[1],cursor,target);
    } else if (request.method === "PATCH" && (path.join("/") === "defaults" || (path[0] === "admins" && path.length === 2))) {
      let body; try { body = await request.json(); } catch { throw new AssistantFault("INVALID_INPUT", "Cài đặt không hợp lệ."); }
      result = await service.save(viewer.email,path[0] === "admins" ? path[1] : null,body);
    } else if (request.method === "POST" && path[0] === "runs" && path[2] === "stop" && path.length === 3) {
      validateSchema(workspaceQuerySchema.properties.conversationId,path[1]); result = await service.stop(viewer.email,path[1]);
    } else if (request.method === "POST" && path[0] === "handoffs" && path.length === 3 && path[2] === "seen") {
      validateSchema(workspaceQuerySchema.properties.conversationId,path[1]); result = await service.markHandoffSeen(viewer.email,path[1]);
    } else if (request.method === "POST" && path[0] === "handoffs" && path.length === 3 && path[2] === "messages") {
      validateSchema(workspaceQuerySchema.properties.conversationId,path[1]);
      let body; try { body=await request.json(); } catch { throw new AssistantFault("INVALID_INPUT","Tin nhắn không hợp lệ"); }
      validateSchema(handoffReplySchema,body); body.message=body.message.trim();
      result = await service.replyHandoff(viewer.email,viewer.name,path[1],body);
    } else if (request.method === "POST" && path[0] === "handoffs" && path.length === 3 && path[2] === "close") {
      validateSchema(workspaceQuerySchema.properties.conversationId,path[1]); result = await service.closeHandoff(viewer.email,path[1]);
    } else throw new AssistantFault("NOT_FOUND", "Không tìm thấy", { status: 404 });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch(error) { return assistantErrorResponse(error); }
}
export const GET = handle;
export const PATCH = handle;
export const POST = handle;
