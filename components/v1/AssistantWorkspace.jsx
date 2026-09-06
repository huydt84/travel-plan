"use client";
import Link from "next/link";
import { useEffect, useRef, useState, ViewTransition } from "react";
import { useRouter } from "next/navigation";
import Dialog, { DialogTitle } from "../ui/Dialog";
import { useAssistantNavigation } from "./AssistantProvider";
import { useConversation } from "./useConversation";
import { apiJson } from "./transport.mjs";
import MessageContent from "./MessageContent";
import Composer from "./Composer";
import { ContextPicker, ReferenceList } from "./ContextReferences";
import AssistantIcon from "./AssistantIcon";
import HistorySidebar from "./HistorySidebar";
import { EvidencePanel, ChangePanel } from "./ProposalReview";
import styles from "./assistant.module.css";

export default function AssistantWorkspace({ initialWorkspace, viewer, tripSlug, companion = false, onClose }) {
  const chat = useConversation({ initialWorkspace, viewer });
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const assistantNavigation = useAssistantNavigation();
  const { setTurns } = chat;
  const [panel, setPanel] = useState(null), [selectedId, setSelectedId] = useState(null), [applying, setApplying] = useState(false);
  const [frame, setFrame] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyWide, setHistoryWide] = useState(false);
  const historyTrigger = useRef(null);
  useEffect(() => {
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => setHistoryWide(entry.contentRect.width >= 900));
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame]);
  const [newResponse, setNewResponse] = useState(false);
  const listRef = useRef(null), nearEnd = useRef(true), olderAnchor = useRef(null), focusCitation = useRef(null), citationFocus = useRef(null);
  const retryFocus = useRef(null);
  const running = chat.turns.some((turn) => turn.status === "running");
  const selected = chat.turns.find((turn) => turn.id === selectedId) || chat.turns.at(-1);
  const changeSet = selected?.changeSet;
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
    if (nearEnd.current) element.scrollTop = element.scrollHeight;
    else if (running) { const timer = setTimeout(() => setNewResponse(true), 0); return () => clearTimeout(timer); }
  }, [chat.turns, running, chat.disconnected, chat.retrying]);
  useEffect(() => {
    nearEnd.current = true;
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [chat.workspace?.selectedConversation?.id]);
  useEffect(() => {
    const expiries = chat.turns.filter((turn) => turn.changeSet?.status === "staged").map((turn) => Date.parse(turn.changeSet.expiresAt));
    if (!expiries.length) return;
    const timer = setTimeout(() => setTurns((items) => items.map((turn) => turn.changeSet?.status === "staged" && Date.parse(turn.changeSet.expiresAt) <= Date.now()
      ? { ...turn, changeSet: { ...turn.changeSet, status: "expired", confirmationToken: null } } : turn)), Math.max(0, Math.min(...expiries) - Date.now()));
    return () => clearTimeout(timer);
  }, [chat.turns, setTurns]);
  const inspect = (turn, nextPanel, citation) => { setSelectedId(turn.id); focusCitation.current = citation || null; setPanel(nextPanel); };
  const confirm = async () => {
    if (!changeSet?.confirmationToken || applying) return;
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
  const content = <section ref={setFrame} data-history-open={historyOpen && historyWide || undefined} className={`${styles.shell} ${companion ? styles.companion : ""}`} aria-label="Trợ lý hành trình">
    <div className={styles.historySlot}>
      {historyWide && <HistorySidebar {...historyProps} wide />}
    </div>
    <div className={styles.workspaceMain} onKeyDown={(event) => { if (historyOpen && event.key === "Escape") { event.stopPropagation(); setHistoryOpen(false); historyTrigger.current?.focus(); } }}>
    <header className={styles.topbar}>
      <div className={styles.headingGroup}>
        <button ref={historyTrigger} className={styles.iconButton} type="button" onClick={() => { setHistoryOpen(!historyOpen); if (!historyOpen) void chat.history(); }} aria-label="Lịch sử" title="Lịch sử" aria-expanded={historyOpen} aria-controls="assistant-history"><AssistantIcon name="history" /></button>
        <h1>Trợ lý hành trình</h1>
      </div>
      <div className={styles.headerActions}>
        {!companion && <Link href={backHref} className={styles.iconButton} aria-label="Lịch trình" title="Lịch trình"><AssistantIcon name="back" /></Link>}
        {!companion && <Link className={styles.iconButton} href={companionHref} onNavigate={() => assistantNavigation?.prepareCompanion(companionHref)} transitionTypes={["assistant-ui"]} aria-label="Thu nhỏ" title="Thu nhỏ về lịch trình"><AssistantIcon name="collapse" /></Link>}
        {companion && <Link className={styles.iconButton} href={expandHref} transitionTypes={["assistant-ui"]} aria-label="Mở rộng" title="Mở rộng"><AssistantIcon name="expand" /></Link>}
        {onClose && <button className={styles.iconButton} type="button" onClick={onClose} aria-label="Đóng" title="Đóng"><AssistantIcon name="close" /></button>}
      </div>
      <div className={styles.toolbar}>
        <button type="button" className={styles.secondaryButton} disabled={chat.loading || chat.submitting} onClick={() => setPickerOpen(true)}>Thêm ngữ cảnh</button>
        {(tripSlug || initialWorkspace?.selectedTripSlug) && <button type="button" className={styles.secondaryButton} disabled={chat.loading || chat.submitting} onClick={async () => {
          try { chat.addMention(await apiJson(`/api/v1/assistant/context?slug=${encodeURIComponent(tripSlug || initialWorkspace.selectedTripSlug)}`)); }
          catch (failure) { chat.setError(failure.message); }
        }}>Thêm chuyến đi này</button>}
        <ReferenceList items={chat.workspace?.pins} label="Ngữ cảnh đã ghim" onRemove={chat.unpin} removeLabel="Bỏ ghim" disabled={chat.pinBusy || chat.submitting} />
      </div>
      <div className={styles.conversationActions}>
        <button className={styles.iconButton} type="button" disabled={chat.loading || chat.submitting} onClick={chat.newConversation} aria-label="Trò chuyện mới" title="Trò chuyện mới"><AssistantIcon name="new" /></button>
      </div>
    </header>
    <div className={styles.turnList} ref={listRef} aria-label="Nội dung cuộc trò chuyện" aria-busy={chat.loading} onScroll={(event) => { const el = event.currentTarget; nearEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; if (nearEnd.current) setNewResponse(false); }}>
      {chat.loading ? <p role="status">Đang tải cuộc trò chuyện…</p> : <>
        {chat.workspace?.nextCursor && <button className={styles.secondaryButton} onClick={() => { olderAnchor.current = listRef.current.scrollHeight; void chat.older(); }}>Xem trao đổi trước</button>}
        {!chat.turns.length && <div className={styles.firstRun}><h2>Cùng lên một chuyến đi vừa ý hơn.</h2><p>Hỏi về lịch trình, tìm hiểu điểm đến, hoặc chuẩn bị thay đổi. Bạn luôn là người quyết định.</p>
          <div>{["Gợi ý điểm đến cho cuối tuần", "Tìm các chuyến đi đã có", "So sánh hai chuyến đi"].map((prompt) => <button key={prompt} onClick={() => { chat.setMessage(prompt); document.getElementById("assistant-message")?.focus(); }}><AssistantIcon name="prompt" /><span>{prompt}</span></button>)}</div></div>}
        {chat.turns.map((turn, index) => <article key={turn.exchangeId || turn.id} className={styles.turn} aria-label={`Lượt trao đổi: ${turn.input}`}>
          <div className={styles.userMessage}><span>Bạn</span><p>{turn.input}</p><ReferenceList label="Ngữ cảnh tin nhắn" items={(turn.mentions || []).map((ref) => turn.resolvedContext?.find((item) => item.ref.kind === ref.kind && item.ref.id === ref.id) || { ref })} onPin={chat.pin} disabled={chat.pinBusy} /></div>
          <div className={styles.assistantMessage} data-exchange={turn.exchangeId || turn.id} tabIndex={-1}><span>Trợ lý</span>
            {turn.output && <MessageContent text={turn.output} citations={turn.citations} onCitation={(citation) => inspect(turn, "evidence", citation)} />}
            {turn.status === "running" && chat.disconnected?.turnId !== turn.id && <p className={styles.running} role="status">{chat.progress || "Đang trả lời…"}</p>}
            {turn.status === "failed" && <div className={styles.interrupted}>
              <p role="status">{turn.errorCode === "TURN_CANCELLED" ? "Đã dừng trả lời." : turn.output ? "Câu trả lời bị gián đoạn." : "Không thể bắt đầu trả lời. Hãy thử lại."}</p>
              {index === chat.turns.length - 1 && <button disabled={running || chat.submitting || chat.loading} onClick={() => { retryFocus.current = turn.exchangeId || turn.id; void chat.retry(turn); }}>{chat.retrying === turn.id ? "Đang thử lại…" : "Thử lại"}</button>}
            </div>}
            {chat.disconnected?.turnId === turn.id && <div className={styles.interrupted}>
              <p role="status">{[401, 403, 404].includes(chat.disconnected.status) ? "Không thể truy cập câu trả lời. Hãy kiểm tra đăng nhập và quyền truy cập." : "Mất kết nối với câu trả lời"}</p>
              {![401, 403, 404].includes(chat.disconnected.status) && <button onClick={chat.reconnect}>Kết nối lại</button>}
            </div>}
            <ReferenceList items={turn.usedContext} label="Ngữ cảnh đã dùng" onPin={chat.pin} disabled={chat.pinBusy} />
            <div className={styles.messageActions}>
              {!!turn.citations?.length && <button onClick={() => inspect(turn, "evidence")}>Nguồn · {turn.citations.length}</button>}
              {turn.status === "completed" && turn.changeSet && <button data-status={turn.changeSet.status} className={styles.reviewButton} onClick={() => inspect(turn, "changes")}>{turn.changeSet.status === "applied" ? "Xem thay đổi đã áp dụng" : ["expired", "conflicted"].includes(turn.changeSet.status) ? "Xem đề xuất không còn hiệu lực" : `Xem ${turn.changeSet.preview.changes.length} thay đổi được đề xuất`}</button>}
            </div>
          </div>
        </article>)}
      </>}
    </div>
    {chat.submissionFailure && <div role="alert" className={styles.errorBanner}>
      <span>{chat.submissionFailure.message}</span>
      {(!chat.submissionFailure.status || chat.submissionFailure.status >= 500) && <button disabled={chat.submitting} onClick={chat.retrySubmission}>Thử lại</button>}
      {chat.submissionFailure.status === 409 && <button onClick={() => chat.load({ trip: chat.workspace.selectedTripSlug, conversation: chat.workspace.selectedConversation?.id })}>Tải lại cuộc trò chuyện</button>}
    </div>}

    {chat.error && <div role="alert" className={styles.errorBanner}>{chat.error}<button onClick={() => chat.load({ trip: chat.workspace?.selectedTripSlug, conversation: chat.workspace?.selectedConversation?.id, replace: true })}>Kết nối lại</button></div>}
    <div className={styles.composerDock}>
    {newResponse && <button className={styles.newResponse} onClick={() => { nearEnd.current = true; listRef.current.scrollTop = listRef.current.scrollHeight; setNewResponse(false); }}>Có câu trả lời mới</button>}
    <ReferenceList items={chat.mentions} label="Ngữ cảnh sắp gửi" onPin={chat.pin} onRemove={(item) => chat.setMentions(chat.mentions.filter((entry) => entry !== item))} disabled={chat.submitting || chat.pinBusy} />
    <Composer onMention={() => setPickerOpen(true)} message={chat.message} setMessage={chat.setMessage} onSubmit={chat.submit} onStop={chat.stop} running={running} disabled={chat.submitting || chat.loading || chat.pinBusy} />
    </div>
    </div>
    {!historyWide && <HistorySidebar {...historyProps} wide={false} />}
    {pickerOpen && <ContextPicker onClose={() => setPickerOpen(false)} onSelect={chat.addMention} />}
    {panel && <Dialog onClose={() => setPanel(null)} pending={applying} overlayClassName={styles.overlay} initialFocusRef={citationFocus}><section className={styles.inspection}><header><DialogTitle>{panel === "evidence" ? "Nguồn tham khảo" : "Xem lại thay đổi"}</DialogTitle><button className={styles.iconButton} disabled={applying} onClick={() => setPanel(null)} aria-label="Đóng" title="Đóng"><AssistantIcon name="close" /></button></header>
      {panel === "evidence" ? <EvidencePanel focusId={focusCitation.current} focusRef={citationFocus} citations={selected?.citations || []} /> : <ChangePanel changeSet={changeSet} busy={applying} onConfirm={confirm} onRegenerate={() => { setPanel(null); chat.setMessage(`Tạo lại đề xuất từ lịch mới nhất: ${selected.input}`); }} />}
    </section></Dialog>}
  </section>;
  return companion ? content : <ViewTransition name="trip-assistant" default="none" share="assistant-morph" enter="assistant-enter" exit="assistant-exit">{content}</ViewTransition>;
}
