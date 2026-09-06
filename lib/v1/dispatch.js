import { start } from "workflow/api";
import { assistantWorkflow } from "../../workflows/assistant";
import { createBackgroundStore } from "./background-store.mjs";
import { dispatchAttempt } from "./dispatch-attempt.mjs";
export async function dispatchAssistantJobs(turnId) {
  const store = createBackgroundStore();
  const job = await store.job(turnId);
  if (!job) return;
  await dispatchAttempt(turnId, { store, segment: job.segment,
    start: (id, segment) => start(assistantWorkflow, [String(id), segment]) });
}
