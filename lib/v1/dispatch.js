import { start } from "workflow/api";
import { assistantWorkflow } from "../../workflows/assistant";
import { createBackgroundStore } from "./background-store.mjs";
import { dispatchAttempt } from "./dispatch-attempt.mjs";
export async function dispatchAssistantJobs(turnId) {
  await dispatchAttempt(turnId, { store: createBackgroundStore(),
    start: (id) => start(assistantWorkflow, [String(id)]) });
}
