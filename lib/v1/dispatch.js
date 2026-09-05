import { start } from "workflow/api";
import { assistantWorkflow } from "../../workflows/assistant";
import { createBackgroundStore } from "./background-store.mjs";
export async function dispatchAssistantJobs(turnId = null) {
  const store = createBackgroundStore();
  const jobs = await store.dispatchable(turnId);
  for (const job of jobs) {
    try {
      const run = await start(assistantWorkflow, [String(job.turn_id)]);
      await store.dispatched(String(job.turn_id), run.runId);
    } catch {
      // Retry survives the request; ambiguous duplicate starts are claim-fenced.
      console.warn("Assistant dispatch pending retry");
    }
  }
}
