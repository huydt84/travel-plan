"use client";
import { useManagementLocale } from "./AssistantManagementControls";
import styles from "./assistant-management.module.css";

const Json = ({ value }) => value === null || value === undefined || (typeof value === "object" && !Object.keys(value).length)
  ? null : <pre tabIndex={0}>{JSON.stringify(value, null, 2)}</pre>;

export default function AssistantExecutionTrace({ allowedTools = [], trace = [], summary, errorCode }) {
  const { t, date } = useManagementLocale();
  if (!summary) return null;
  const tokenEntries = Object.entries(summary.tokens || {}).filter(([, value]) => value !== null);
  const finalModel = [...trace].reverse().find((step) => step.kind === "model");
  return <section className={styles.trace} aria-label={t("assistantTrace.title")}>
    <h3>{t("assistantTrace.title")}</h3>
    <div className={styles.traceSummary}>
      <span>{t("assistantTrace.models", { count: summary.modelInteractions })}</span>
      <span>{t("assistantTrace.tools", { count: summary.executedTools })}</span>
      <span>{t("assistantTrace.tokens", { count: summary.tokens?.totalTokens || 0 })}</span>
    </div>
    <details className={styles.traceTools}><summary>{t("assistantTrace.allowed", { count: allowedTools.length })}</summary>
      <p>{allowedTools.length ? allowedTools.map((name) => t(`assistantTools.${name}.label`)).join(", ") : t("assistantTrace.noneAllowed")}</p>
    </details>
    {errorCode === "TOOL_BUDGET_EXCEEDED" && <p className={styles.traceBudget}>{t("assistantTrace.budgetExceeded")}</p>}
    <dl className={styles.tokenGrid}>{tokenEntries.map(([key, value]) => <div key={key}><dt>{t(`assistantTrace.${key}`)}</dt><dd>{value}</dd></div>)}</dl>
    <div className={styles.traceSteps}>{trace.map((step) => {
      const request = step.request || {};
      const result = step.result || {};
      const calls = result.functionCalls || [];
      const thoughts = result.thoughtSummaries || [];
      const rejected = errorCode === "TOOL_BUDGET_EXCEEDED" && step.id === finalModel?.id && calls.length;
      return <details key={step.id} className={styles.traceStep} open={Boolean(rejected)}>
        <summary><span>{step.ordinal}. {step.kind === "model" ? t("assistantTrace.model") : t("assistantTrace.tool")}: {step.name}</span><small>{step.status} · {step.durationMs ?? "–"} ms</small></summary>
        <div className={styles.traceStepBody}>
          <p className={styles.muted}>{date(step.startedAt)} JST{step.code ? ` · ${step.code}` : ""}</p>
          {step.legacy && <p className={styles.muted}>{t("assistantTrace.legacy")}</p>}
          {step.kind === "model" ? <>
            <h4>{t("assistantTrace.offered")}</h4><p>{(request.offeredTools || []).join(", ") || t("assistantTrace.noneAllowed")}</p>
            <h4>{t("assistantTrace.remaining")}</h4><p>{request.remainingToolBudget ?? "–"}</p>
            {result.truncated && <Json value={result} />}
            {!!thoughts.length && <><h4>{t("assistantTrace.thoughtSummaries")}</h4><div className={styles.traceThoughts}>
              {thoughts.map((thought, index) => <details key={index} className={styles.traceThought}>
                <summary>{thought.title || t("assistantTrace.thoughtStage", { count: index + 1 })}</summary>
                <pre tabIndex={0}>{thought.text}</pre>
              </details>)}
            </div></>}
            {!!result.publicText && <><h4>{t("assistantTrace.publicText")}</h4><pre tabIndex={0}>{result.publicText}</pre></>}
            {!!calls.length && <><h4>{rejected ? t("assistantTrace.rejectedCalls") : t("assistantTrace.requestedCalls")}</h4><Json value={calls} /></>}
          </> : <>
            <h4>{t("assistantTrace.parameters")}</h4><Json value={request.arguments || request} />
            <h4>{t("assistantTrace.result")}</h4><Json value={result.result ?? result} />
          </>}
          {step.usage && <><h4>{t("assistantTrace.usage")}</h4><Json value={step.usage} /></>}
        </div>
      </details>;
    })}</div>
  </section>;
}
