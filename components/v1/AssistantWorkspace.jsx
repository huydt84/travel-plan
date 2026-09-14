"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, ViewTransition } from "react";
import { useRouter } from "next/navigation";
import Dialog, { DialogTitle } from "../ui/Dialog";
import { useAssistantNavigation } from "./AssistantProvider";
import { useConversation } from "./useConversation";
import { apiJson } from "./transport.mjs";
import BatchReview from "./BatchReview";
import QuestionPrompt from "./QuestionPrompt";
import MessageContent from "./MessageContent";
import Composer from "./Composer";
import { ContextPicker, ReferenceList } from "./ContextReferences";
import AssistantIcon from "./AssistantIcon";
import HistorySidebar from "./HistorySidebar";
import { EvidencePanel, ChangePanel } from "./ProposalReview";
import LanguageSwitcher from "../LanguageSwitcher";
import { localizeAssistantMessage } from "../../lib/i18n-assistant.mjs";
import { useLocale } from "../LocaleProvider";
import styles from "./assistant.module.css";

export default function AssistantWorkspace({ initialWorkspace, viewer, tripSlug, companion = false, onClose }) {
  const chat = useConversation({ initialWorkspace, viewer });
  const router = useRouter();
  const { t, intlLocale } = useLocale();
  const [pickerOpen, setPickerOpen] = useState(false);
  const assistantNavigation = useAssistantNavigation();
  const { setTurns } = chat;
  const [panel, setPanel] = useState(null), [selectedId, setSelectedId] = useState(null), [applying, setApplying] = useState(false);
  const [frame, setFrame] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyWide, setHistoryWide] = useState(false);
  const [editingTurnId, setEditingTurnId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [copiedMessage, setCopiedMessage] = useState(null);
  const historyTrigger = useRef(null);
  const copyReset = useRef(null);
  useEffect(() => {
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => setHistoryWide(entry.contentRect.width >= 900));
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame]);
  useEffect(() => () => clearTimeout(copyReset.current), []);
  const [newResponse, setNewResponse] = useState(false);
  const listRef = useRef(null), nearEnd = useRef(true), olderAnchor = useRef(null), focusCitation = useRef(null), citationFocus = useRef(null);
  const retryFocus = useRef(null), announcedQuestion = useRef(null);
  const access = chat.workspace?.access;
  const restricted = access?.enabled === false;
  const quotaBlocked = access && ((access.daily !== null && access.dailyUsed >= access.daily) || (access.weekly !== null && access.weeklyUsed >= access.weekly));
  const requestBlocked = restricted || quotaBlocked;
  const running = chat.turns.some((turn) => turn.status === "running");
  const selected = chat.turns.find((turn) => turn.id === selectedId) || chat.turns.at(-1);
  const changeSet = selected?.changeSet;
  const awaiting = chat.turns.some((t) => t.status === "awaiting_approval");
  const awaitingInput = chat.turns.some((t) => t.status === "awaiting_input");
  const pendingQuestionId = chat.turns.flatMap((turn) => turn.questions || []).find((question) => question.status === "pending")?.id || null;
  useEffect(() => {
    if (!chat.retrying && retryFocus.current) {
      const target = listRef.current?.querySelector(`[data-exchange="${retryFocus.current}"]`);
      target?.focus({ preventScroll: true });
      retryFocus.current = null;
    }
  }, [chat.retrying]);
  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    if (olderAnchor.current !== null) { element.scrollTop += element.scrollHeight - olderAnchor.current; olderAnchor.current = null; return; }
    if (nearEnd.current && !pendingQuestionId) element.scrollTop = element.scrollHeight;
    else if (running) { const timer = setTimeout(() => setNewResponse(true), 0); return () => clearTimeout(timer); }
  }, [chat.turns, chat.workspace?.handoffMessages, chat.workspace?.activeHandoff, running, chat.disconnected, chat.retrying, pendingQuestionId]);
  useEffect(() => {
    if (!pendingQuestionId) { announcedQuestion.current = null; return; }
    if (announcedQuestion.current === pendingQuestionId) return;
    listRef.current?.querySelector(`[data-question-id="${pendingQuestionId}"]`)?.scrollIntoView({ block: "start" });
    announcedQuestion.current = pendingQuestionId;
  }, [pendingQuestionId]);
  useEffect(() => {
    nearEnd.current = true;
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [chat.workspace?.selectedConversation?.id]);
  useEffect(() => {
    const expiries = chat.turns.flatMap((turn) => [
      ...(turn.changeSet?.status === "staged" ? [Date.parse(turn.changeSet.expiresAt)] : []),
      ...(turn.actions || []).filter((action) => action.status === "pending").map((action) => Date.parse(action.expiresAt)),
    ]);
    if (!expiries.length) return;
    const timer = setTimeout(() => setTurns((items) => items.map((turn) => ({ ...turn,
      ...(turn.changeSet?.status === "staged" && Date.parse(turn.changeSet.expiresAt) <= Date.now() ? { changeSet: { ...turn.changeSet, status: "expired", confirmationToken: null } } : {}),
      actions: turn.actions?.map((action) => action.status === "pending" && Date.parse(action.expiresAt) <= Date.now() ? { ...action, status: "expired", confirmationToken: null } : action),
    }))), Math.max(0, Math.min(...expiries) - Date.now()));
    return () => clearTimeout(timer);
  }, [chat.turns, setTurns]);
  const inspect = (turn, nextPanel, citation) => { setSelectedId(turn.id); focusCitation.current = citation || null; setPanel(nextPanel); };
  const inspectCitation = useCallback((turnId, citation) => {
    setSelectedId(turnId);
    focusCitation.current = citation;
    setPanel("evidence");
  }, []);
  const confirm = async () => {
    if (restricted || !changeSet?.confirmationToken || applying) return;
    setApplying(true); chat.setError("");
    try {
      const receipt = await apiJson(`/api/v1/assistant/proposals/${changeSet.id}/confirm`, { method: "POST", body: JSON.stringify({ confirmationToken: changeSet.confirmationToken }) });
      chat.setTurns((items) => items.map((turn) => turn.id === selected.id ? { ...turn, changeSet: { ...turn.changeSet, status: "applied", receipt, confirmationToken: null } } : turn));
      router.refresh();
    } catch (failure) {
      chat.setError(failure.message);
      if (["PLAN_CONFLICT", "PROPOSAL_EXPIRED"].includes(failure.code)) chat.setTurns((items) => items.map((turn) => turn.id === selected.id ? { ...turn, changeSet: { ...turn.changeSet, status: failure.code === "PLAN_CONFLICT" ? "conflicted" : "expired", confirmationToken: null } } : turn));
    } finally { setApplying(false); }
  };
  const decideBatch = async (action, decision) => {
    if (!action || applying || restricted) return;
    const conversationId = chat.workspace.selectedConversation?.id;
    setApplying(true); chat.setError("");
    try {
      await apiJson(`/api/v1/assistant/actions/${action.id}/${decision}`, { method: "POST", body: JSON.stringify(decision === "approve" ? { confirmationToken: action.confirmationToken } : {}) });
      window.dispatchEvent(new Event("assistant-completed"));
      window.dispatchEvent(new Event("assistant-resources-changed"));
      await chat.refreshConversation(conversationId);
    } catch (failure) {
      // A lost response may follow a committed batch. Reconcile; never repeat the write.
      let recovered;
      try { recovered = await chat.refreshConversation(conversationId); } catch { /* Keep the existing request visible for reconnect. */ }
      const resolved = recovered?.turns.flatMap((turn) => turn.actions || []).find((item) => item.id === action.id);
      if (resolved?.status === "applied") window.dispatchEvent(new Event("assistant-resources-changed"));
      else if (resolved?.status !== "rejected") chat.setError(failure.message);
    } finally { setApplying(false); }
  };
  const reviseBatch = async (action, edits) => {
    if (!action || applying || restricted) return;
    setApplying(true); chat.setError("");
    try {
      const result = await apiJson(`/api/v1/assistant/actions/${action.id}/revise`, {
        method: "POST", body: JSON.stringify({ expectedDigest: action.digest, edits }),
      });
      chat.setTurns((items) => items.map((turn) => ({
        ...turn,
        actions: turn.actions?.map((item) => item.id === action.id ? result.action : item),
      })));
      return result.action;
    } catch (failure) {
      // A lost response may follow a committed revision. Reconcile before showing an error.
      let recovered;
      if (!failure.status || failure.status >= 500) {
        try { recovered = await chat.refreshConversation(chat.workspace?.selectedConversation?.id); } catch { /* Keep the local draft available for retry. */ }
        const replacement = recovered?.turns.flatMap((turn) => turn.actions || []).find((item) => item.supersedesActionId === action.id);
        if (replacement) return replacement;
      }
      throw failure;
    } finally { setApplying(false); }
  };
  const answerQuestion = async (question, input) => {
    const conversationId = chat.workspace?.selectedConversation?.id;
    try {
      await apiJson(`/api/v1/assistant/questions/${question.id}/answer`, { method: "POST", body: JSON.stringify(input) });
      await chat.refreshConversation(conversationId);
    } catch (failure) {
      let recovered;
      try { recovered = await chat.refreshConversation(conversationId); } catch { /* Keep the selected answers available for another attempt. */ }
      const resolved = recovered?.turns.flatMap((turn) => turn.questions || []).find((item) => item.id === question.id);
      if (resolved?.status === "answered") return;
      throw failure;
    }
  };
  const copyMessage = async (key, value) => {
    try {
      await navigator.clipboard.writeText(value);
      clearTimeout(copyReset.current);
      setCopiedMessage(key);
      copyReset.current = setTimeout(() => setCopiedMessage((current) => current === key ? null : current), 1800);
    } catch { chat.setError("assistantExtra.error.copyMessage"); }
  };
  const copyButton = (key, value, kind) => {
    const copied = copiedMessage === key;
    const label = t(copied ? `assistantExtra.copied.${kind}` : `assistantExtra.copy.${kind}`);
    return <button type="button" onClick={() => void copyMessage(key, value)} aria-label={label} title={label} aria-live="polite"><AssistantIcon name={copied ? "check" : "copy"} /></button>;
  };
  const trackerTrip = tripSlug || initialWorkspace?.selectedTripSlug || null;
  const navigationQuery = new URLSearchParams();
  if (trackerTrip) navigationQuery.set("trip", trackerTrip);
  if (chat.workspace?.selectedConversation) navigationQuery.set("conversation", chat.workspace.selectedConversation.id);
  const expandHref = `/assistant${navigationQuery.size ? `?${navigationQuery}` : ""}`;
  const backHref = trackerTrip ? `/?trip=${encodeURIComponent(trackerTrip)}` : "/";
  navigationQuery.set("chat", "1");
  const companionHref = `/?${navigationQuery}`;
  const historyProps = {
    open: historyOpen, container: frame, triggerRef: historyTrigger,
    onClose: () => setHistoryOpen(false), onNew: chat.newConversation, onSelect: chat.selectConversation,
    conversations: chat.workspace?.conversations || [], selectedId: chat.workspace?.selectedConversation?.id,
    onMore: () => chat.history(true), hasMore: !!chat.workspace?.historyCursor,
    loading: chat.historyLoading, error: chat.historyError, onRetry: () => chat.history(),
  };
  const timeline = [
    ...chat.turns.map((turn) => ({ kind:"turn",id:turn.exchangeId || turn.id,at:turn.createdAt,value:turn,rank:1 })),
    ...(chat.workspace?.handoffMessages || []).map((message) => ({ kind:"handoff-message",id:message.id,at:message.createdAt,value:message,rank:1,order:message.ordinal || 0 })),
    ...(chat.workspace?.handoffs || []).flatMap((handoff) => [
      { kind:"handoff-start",id:`${handoff.id}-start`,at:handoff.startedAt,value:handoff,rank:0 },
      ...(handoff.closedAt ? [{ kind:"handoff-end",id:`${handoff.id}-end`,at:handoff.closedAt,value:handoff,rank:2 }] : []),
    ]),
  ].sort((left,right) => left.order&&right.order ? left.order-right.order : Date.parse(left.at)-Date.parse(right.at) || left.rank-right.rank || left.id.localeCompare(right.id));
  const renderTimeline = (entry,index) => {
    if (entry.kind === "handoff-start" || entry.kind === "handoff-end") return <div key={entry.id} className={styles.handoffNotice} role="status">
      <strong>{entry.kind === "handoff-start" ? t("assistantExtra.handoff.active") : t("assistantExtra.handoff.closed")}</strong>
      <span>{entry.kind === "handoff-start" ? t("assistantExtra.handoff.activeHelp") : t("assistantExtra.handoff.closedHelp")}</span>
    </div>;
    if (entry.kind === "handoff-message") {
      const item=entry.value,owner=item.author.role === "owner";
      return <article key={entry.id} className={styles.turn} aria-label={owner ? t("assistantExtra.handoff.ownerMessage") : t("assistantExtra.handoff.userMessage")}>
        {owner ? <div className={`${styles.assistantMessage} ${styles.ownerMessage}`}><span>{t("assistantExtra.handoff.owner")}</span><p>{item.body}</p>
          <div className={styles.messageIconActions}>{copyButton(`handoff:${item.id}`, item.body, "response")}</div>
        </div> : <div className={styles.userTurn}><div className={styles.userMessage}><span>{t("assistantExtra.you")}</span><p>{item.body}</p>
          <ReferenceList label={t("assistantExtra.messageContext")} items={(item.contextRefs || []).map(ref=>({ref}))} onPin={chat.pin} disabled={restricted || chat.pinBusy} />
        </div><div className={styles.messageIconActions}>{copyButton(`handoff:${item.id}`, item.body, "message")}</div></div>}
      </article>;
    }
    const turn=entry.value;
    const hasAppliedChanges = turn.changeSet?.status === "applied" || turn.actions?.some((action) => action.status === "applied");
    const canEdit = index === timeline.length - 1 && ["completed", "failed"].includes(turn.status) && !hasAppliedChanges && !requestBlocked && !running && !chat.submitting && !chat.loading;
    const canRegenerate = canEdit && turn.status === "completed";
    const editing = editingTurnId === turn.id;
    return <article key={entry.id} className={styles.turn} aria-label={t("assistantExtra.exchange", { input: turn.input })}>
      <div className={styles.userTurn}><div className={styles.userMessage}><span>{t("assistantExtra.you")}</span>
        {editing ? <form className={styles.messageEditor} onSubmit={async (event) => { event.preventDefault(); if (await chat.replace(turn, editDraft)) setEditingTurnId(null); }}>
          <textarea autoFocus aria-label={t("assistantExtra.editMessageLabel")} value={editDraft} maxLength={4000} onChange={(event) => setEditDraft(event.target.value)} />
          <div><button type="button" onClick={() => setEditingTurnId(null)}>{t("assistantExtra.cancel")}</button><button type="submit" disabled={!editDraft.trim() || chat.submitting}>{chat.retrying === turn.id ? t("assistantExtra.regenerating") : t("assistantExtra.saveAndRegenerate")}</button></div>
        </form> : <><p>{turn.input}</p><ReferenceList label={t("assistantExtra.messageContext")} items={(turn.mentions || []).map((ref) => turn.resolvedContext?.find((item) => item.ref.kind === ref.kind && item.ref.id === ref.id) || { ref })} onPin={chat.pin} disabled={restricted || chat.pinBusy} /></>}
      </div>{!editing && <div className={styles.messageIconActions}>{copyButton(`input:${turn.id}`, turn.input, "message")}{canEdit && <button type="button" onClick={() => { setEditDraft(turn.input); setEditingTurnId(turn.id); }} aria-label={t("assistantExtra.editMessage")} title={t("assistantExtra.editMessage")}><AssistantIcon name="edit" /></button>}</div>}</div>
      <div className={styles.assistantMessage} data-exchange={turn.exchangeId || turn.id} tabIndex={-1}><span>{t("assistantExtra.assistant")}</span>
        {turn.output && <MessageContent turnId={turn.id} text={turn.output} citations={turn.citations} streaming={turn.status === "running"} onCitation={inspectCitation} />}
        {turn.status === "running" && chat.disconnected?.turnId !== turn.id && <p className={styles.running} role="status">{localizeAssistantMessage(t, chat.progress) || t("assistantExtra.answering")}</p>}
        {turn.status === "failed" && <div className={styles.interrupted}><p role="status">{turn.errorCode === "TURN_CANCELLED" ? t("assistantExtra.answerStopped") : turn.errorCode === "TURN_DEADLINE_EXCEEDED" ? t("assistantExtra.answerTimedOut") : turn.output ? t("assistantExtra.answerInterrupted") : t("assistantExtra.answerStartFailed")}</p>
          {index === timeline.length-1 && <button disabled={requestBlocked || running || chat.submitting || chat.loading} onClick={() => { retryFocus.current=turn.exchangeId || turn.id;void chat.retry(turn); }}>{chat.retrying === turn.id ? t("assistantExtra.retrying") : t("assistantExtra.retry")}</button>}</div>}
        {chat.disconnected?.turnId === turn.id && <div className={styles.interrupted}><p role="status">{[401,403,404].includes(chat.disconnected.status) ? t("assistantExtra.answerAccessError") : t("assistantExtra.answerDisconnected")}</p>{![401,403,404].includes(chat.disconnected.status) && <button onClick={chat.reconnect}>{t("assistantExtra.reconnect")}</button>}</div>}
        {turn.questions?.map((question) => <QuestionPrompt key={question.id} prompt={question} readOnly={restricted} onSubmit={answerQuestion} />)}
        {turn.actions?.map((item) => <BatchReview key={item.id} action={item} busy={applying} readOnly={restricted} onApprove={() => decideBatch(item,"approve")} onReject={() => decideBatch(item,"reject")} onRevise={(action,edits) => edits ? reviseBatch(action,edits) : (() => { chat.setMessage(`Tạo lại đề xuất: ${turn.input}`);document.getElementById("assistant-message")?.focus(); })()} />)}
        <ReferenceList items={turn.usedContext} label={t("assistantExtra.usedContext")} onPin={chat.pin} disabled={restricted || chat.pinBusy} />
        <div className={styles.messageActions}>{!!turn.citations?.length && <button onClick={() => inspect(turn,"evidence")}>{t("assistantExtra.sourceCount",{count:turn.citations.length})}</button>}{turn.status === "completed" && turn.changeSet && <button data-status={turn.changeSet.status} className={styles.reviewButton} onClick={() => inspect(turn,"changes")}>{turn.changeSet.status === "applied" ? t("assistantExtra.viewApplied") : ["expired","conflicted"].includes(turn.changeSet.status) ? t("assistantExtra.viewStale") : t("assistantExtra.viewProposed",{count:turn.changeSet.preview.changes.length})}</button>}</div>
        {!!turn.output && turn.status !== "running" && <div className={styles.messageIconActions}>{copyButton(`output:${turn.id}`, turn.output, "response")}{canRegenerate && <button type="button" onClick={() => void chat.replace(turn)} aria-label={t("assistantExtra.regenerateResponse")} title={t("assistantExtra.regenerateResponse")}><AssistantIcon name="regenerate" /></button>}</div>}
      </div>
    </article>;
  };
  const content = <section ref={setFrame} data-history-open={historyOpen && historyWide || undefined} className={`${styles.shell} ${companion ? styles.companion : ""}`} aria-label={t("assistant.title")}>
    <div className={styles.historySlot}>
      {historyWide && <HistorySidebar {...historyProps} wide />}
    </div>
    <div className={styles.workspaceMain} onKeyDown={(event) => { if (historyOpen && event.key === "Escape") { event.stopPropagation(); setHistoryOpen(false); historyTrigger.current?.focus(); } }}>
    <header className={styles.topbar}>
      <div className={styles.headingGroup}>
        <button ref={historyTrigger} className={styles.iconButton} type="button" onClick={() => { setHistoryOpen(!historyOpen); if (!historyOpen) void chat.history(); }} aria-label={t("assistant.history")} title={t("assistant.history")} aria-expanded={historyOpen} aria-controls="assistant-history"><AssistantIcon name="history" /></button>
        <h1>{t("assistant.title")}</h1>
      </div>
      <div className={styles.headerActions}>
        {!companion && <Link href={backHref} className={styles.iconButton} aria-label={t("assistant.scheduleLink")} title={t("assistant.scheduleLink")}><AssistantIcon name="back" /></Link>}
        {!companion && <Link className={styles.iconButton} href={companionHref} onNavigate={() => assistantNavigation?.prepareCompanion(companionHref)} transitionTypes={["assistant-ui"]} aria-label={t("assistant.collapse")} title={t("assistant.collapse")}><AssistantIcon name="collapse" /></Link>}
        {companion && <Link className={styles.iconButton} href={expandHref} transitionTypes={["assistant-ui"]} aria-label={t("assistant.expand")} title={t("assistant.expand")}><AssistantIcon name="expand" /></Link>}
        {onClose && <button className={styles.iconButton} type="button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")}><AssistantIcon name="close" /></button>}
      </div>
      <div className={styles.toolbar}>
        <button type="button" className={styles.secondaryButton} disabled={restricted || chat.loading || chat.submitting} onClick={() => setPickerOpen(true)}>{t("assistant.addContext")}</button>
        {(tripSlug || initialWorkspace?.selectedTripSlug) && <button type="button" className={styles.secondaryButton} disabled={restricted || chat.loading || chat.submitting} onClick={async () => {
          try { chat.addMention(await apiJson(`/api/v1/assistant/context?slug=${encodeURIComponent(tripSlug || initialWorkspace.selectedTripSlug)}`)); }
          catch (failure) { chat.setError(failure.message); }
        }}>{t("assistant.addTrip")}</button>}
        <ReferenceList items={chat.workspace?.pins} label={t("assistant.pinnedContext")} onRemove={chat.unpin} removeLabel={t("assistant.unpin")} disabled={restricted || chat.pinBusy || chat.submitting} />
      </div>
      <div className={styles.conversationActions}>
        <button className={styles.iconButton} type="button" disabled={restricted || chat.loading || chat.submitting} onClick={chat.newConversation} aria-label={t("assistant.newConversation")} title={t("assistant.newConversation")}><AssistantIcon name="new" /></button>
        <LanguageSwitcher />
      </div>
    </header>
    <div className={styles.turnList} ref={listRef} aria-label={t("assistantExtra.conversationContent")} aria-busy={chat.loading} onScroll={(event) => { const el = event.currentTarget; nearEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; if (nearEnd.current) setNewResponse(false); }}>
      {access && !viewer.isOwner && <p className={styles.accessSummary}>{t("assistant.ownerCanView")}</p>}
      {access && <details className={styles.accessSummary}><summary>{restricted ? t("assistant.disabledReadOnly") : quotaBlocked ? t("assistant.quotaReached") : t("assistant.accessAndLimits")}</summary>
        <p>{access.model} · {t("assistant.thinking")}: {({ default: t("assistant.providerDefault"), minimal: t("assistant.minimal"), low: t("assistant.low"), medium: t("assistant.medium"), high: t("assistant.high") })[access.effort]}</p>
        <p>{t("assistant.remainingToday", { count: access.daily === null ? t("assistant.unlimited") : Math.max(0,access.daily-access.dailyUsed) })}; {t("assistant.remainingWeek", { count: access.weekly === null ? t("assistant.unlimited") : Math.max(0,access.weekly-access.weeklyUsed) })}.</p>
        <p>{t("assistant.resetAt", { daily: new Date(access.dailyReset).toLocaleString(intlLocale, { timeZone:"Asia/Tokyo", hour12: false }), weekly: new Date(access.weeklyReset).toLocaleString(intlLocale, { timeZone:"Asia/Tokyo", hour12: false }) })}</p>
      </details>}
      {chat.turns.filter((turn) => turn.status === "completed").length >= 8 && <div role="status" className={styles.errorBanner} style={{ background: "var(--surface-muted, #fff8e1)" }}>{t("assistant.longConversationWarning")} <button className={styles.secondaryButton} onClick={chat.newConversation}>{t("assistant.newSession")}</button></div>}
      {chat.loading ? <p role="status">{t("assistant.loadingConversation")}</p> : <>
        {chat.workspace?.nextCursor && <button className={styles.secondaryButton} onClick={() => { olderAnchor.current = listRef.current.scrollHeight; void chat.older(); }}>{t("assistant.olderTurns")}</button>}
        {!timeline.length && <div className={styles.firstRun}><h2>{t("assistant.firstRunTitle")}</h2><p>{t("assistant.firstRunDescription")}</p>
          <div>{[t("assistant.promptDestination"), t("assistant.promptExisting"), t("assistant.promptCompare")].map((prompt) => <button key={prompt} onClick={() => { chat.setMessage(prompt); document.getElementById("assistant-message")?.focus(); }}><AssistantIcon name="prompt" /><span>{prompt}</span></button>)}</div></div>}
        {timeline.map(renderTimeline)}
      </>}
    </div>
    {chat.submissionFailure && <div role="alert" className={styles.errorBanner}>
      <span>{localizeAssistantMessage(t, chat.submissionFailure.message)}</span>
      {(!chat.submissionFailure.status || chat.submissionFailure.status >= 500) && <button disabled={chat.submitting} onClick={chat.retrySubmission}>{t("assistantExtra.retry")}</button>}
      {chat.submissionFailure.status === 409 && <button onClick={() => chat.load({ trip: chat.workspace.selectedTripSlug, conversation: chat.workspace.selectedConversation?.id })}>{t("assistantExtra.reloadConversation")}</button>}
    </div>}

    {chat.error && <div role="alert" className={styles.errorBanner}>{localizeAssistantMessage(t, chat.error)}<button onClick={() => chat.load({ trip: chat.workspace?.selectedTripSlug, conversation: chat.workspace?.selectedConversation?.id, replace: true })}>{t("assistantExtra.reconnect")}</button></div>}
    <div className={styles.composerDock}>
    {newResponse && <button className={styles.newResponse} onClick={() => { nearEnd.current = true; listRef.current.scrollTop = listRef.current.scrollHeight; setNewResponse(false); }}>{t("assistantExtra.newAnswer")}</button>}
    <Composer context={<ReferenceList items={chat.mentions} label={t("assistantExtra.pendingContext")} onPin={chat.pin} onRemove={(item) => chat.setMentions(chat.mentions.filter((entry) => entry !== item))} disabled={restricted || chat.submitting || chat.pinBusy} />} onMention={() => setPickerOpen(true)} message={chat.message} setMessage={chat.setMessage} onSubmit={chat.submit} onStop={chat.stop} running={running || awaiting || awaitingInput} disabled={(!chat.workspace?.activeHandoff && requestBlocked) || chat.submitting || chat.loading || chat.pinBusy || awaitingInput}
      availableTools={chat.workspace?.availableTools || []} allowedTools={chat.allowedTools} onAllowedToolsChange={chat.setAllowedTools} />
    </div>
    </div>
    {!historyWide && <HistorySidebar {...historyProps} wide={false} />}
    {pickerOpen && <ContextPicker onClose={() => setPickerOpen(false)} onSelect={chat.addMention} />}
    {panel && <Dialog onClose={() => setPanel(null)} pending={applying} overlayClassName={styles.overlay} initialFocusRef={citationFocus}><section className={styles.inspection}><header><DialogTitle>{panel === "evidence" ? t("assistantExtra.references") : t("assistantExtra.reviewChanges")}</DialogTitle><button className={styles.iconButton} disabled={applying} onClick={() => setPanel(null)} aria-label={t("assistantExtra.close")} title={t("assistantExtra.close")}><AssistantIcon name="close" /></button></header>
      {panel === "evidence" ? <EvidencePanel focusId={focusCitation.current} focusRef={citationFocus} citations={selected?.citations || []} /> : <ChangePanel readOnly={restricted} changeSet={changeSet} busy={applying} onConfirm={confirm} onRegenerate={() => { setPanel(null); chat.setMessage(`Tạo lại đề xuất từ lịch mới nhất: ${selected.input}`); }} />}
    </section></Dialog>}
  </section>;
  return companion ? content : <ViewTransition name="trip-assistant" default="none" share="assistant-morph" enter="assistant-enter" exit="assistant-exit">{content}</ViewTransition>;
}
