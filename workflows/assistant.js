import { getWorkflowMetadata } from "workflow";
export async function assistantWorkflow(turnId, segment = 0) {
  "use workflow";
  await execute(turnId, getWorkflowMetadata().workflowRunId, segment);
}
async function execute(turnId, workflowId, segment) {
  "use step";
  const { executeBackgroundTurn } = await import("../lib/v1/background.mjs");
  await executeBackgroundTurn(turnId, workflowId, segment);
}
