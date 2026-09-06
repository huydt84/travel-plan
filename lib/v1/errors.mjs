import { policyDatabaseFault } from "./assistant-policy.mjs";
export class AssistantFault extends Error {
  constructor(code, message, { status = 400, retryable = false, details = null } = {}) {
    super(message);
    this.name = "AssistantFault";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export const assistantFault = (error) => {
  if (error instanceof AssistantFault) return error;
  const policyFault = policyDatabaseFault(error);
  if (policyFault) return policyFault;
  if (error?.code === "23505") {
    return new AssistantFault("TURN_IN_PROGRESS", "Cuộc trò chuyện đang xử lý một yêu cầu khác", { status: 409, retryable: true });
  }
  return new AssistantFault("ASSISTANT_UNAVAILABLE", "Trợ lý tạm thời không khả dụng", { status: 503, retryable: true });
};

export function assertPilotActor(actor) {
  if (!actor?.email || !actor?.isAdmin) {
    throw new AssistantFault("PILOT_FORBIDDEN", "Bản thử nghiệm chỉ dành cho owner và admin", { status: 403 });
  }
  return {
    email: actor.email.trim().toLowerCase(),
    name: actor.name || actor.email.split("@")[0],
    role: actor.isOwner ? "owner" : "admin",
    isOwner: Boolean(actor.isOwner),
    isAdmin: true,
  };
}
