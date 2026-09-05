import { getWorkflowMetadata } from "workflow";
export async function assistantWorkflow(turnId) {
  "use workflow";
  await execute(turnId, getWorkflowMetadata().workflowRunId);
}
async function execute(turnId, workflowId) {
  "use step";
  const { executeBackgroundTurn } = await import("../lib/v1/background.mjs");
  await executeBackgroundTurn(turnId, workflowId);
}
