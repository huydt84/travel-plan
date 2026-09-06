import { AssistantFault } from "./errors.mjs";
import { refKey } from "./context.mjs";
import { compilePlanProposal } from "./proposal.mjs";
import { validatePlanOperations } from "./schemas.mjs";
import { safeSourceUrl } from "./evidence.mjs";

// Context identifies what may inform an answer; only this explicit target owns a write.
export async function preparePlanChanges({ actor, trip, operations, previousTarget, evidence, contextService }) {
  if (previousTarget && refKey(previousTarget) !== refKey(trip))
    throw new AssistantFault("MULTIPLE_TARGETS", "Mỗi câu trả lời chỉ đề xuất sửa một chuyến đi");
  const snapshot = await contextService.targetSnapshot(actor, trip);
  validatePlanOperations(operations);
  const knownSources = new Set([...evidence, ...snapshot.sources].map((item) => item.url));
  if (operations.some((op) => op.kind === "source.add" && (!safeSourceUrl(op.url) || !knownSources.has(op.url))))
    throw new AssistantFault("INVALID_EVIDENCE", "Hãy tra cứu URL nguồn trước khi thêm vào lịch");
  return { targetRef: trip, targetSnapshot: snapshot, operations, compiledProposal: compilePlanProposal(snapshot, operations) };
}
