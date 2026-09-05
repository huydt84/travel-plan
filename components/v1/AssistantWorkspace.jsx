"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Dialog, { DialogTitle } from "../ui/Dialog";
import { useConversation } from "./useConversation";
import { apiJson } from "./transport.mjs";
import MessageContent from "./MessageContent";
import Composer from "./Composer";
import ConversationHistory from "./ConversationHistory";
import { EvidencePanel, ChangePanel } from "./ProposalReview";
import styles from "./assistant.module.css";

export default function AssistantWorkspace({ initialWorkspace, viewer, tripSlug, companion = false, onClose, onTripChange }) {
  const chat = useConversation({ initialWorkspace, viewer, tripSlug, onTripChange });
  const router = useRouter();
  const { setTurns } = chat;
  const [panel, setPanel] = useState(null), [selectedId, setSelectedId] = useState(null), [applying, setApplying] = useState(false);
  const [newResponse, setNewResponse] = useState(false);
  const listRef = useRef(null), nearEnd = useRef(true), olderAnchor = useRef(null), focusCitation = useRef(null), citationFocus = useRef(null);
  const running = chat.turns.some((turn) => turn.status === "running");
  const selected = chat.turns.find((turn) => turn.id === selectedId) || chat.turns.at(-1);
  const changeSet = selected?.changeSet;
  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    if (olderAnchor.current !== null) { element.scrollTop += element.scrollHeight - olderAnchor.current; olderAnchor.current = null; return; }
    if (nearEnd.current) element.scrollTop = element.scrollHeight;
    else if (running) { const timer = setTimeout(() => setNewResponse(true), 0); return () => clearTimeout(timer); }
  }, [chat.turns, running]);
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
  return <section className={`${styles.shell} ${companion ? styles.companion : ""}`} aria-label="Trợ lý hành trình">
    <header className={styles.topbar}>
      <div><Link href={`/?trip=${encodeURIComponent(chat.workspace?.selectedTripSlug || tripSlug || "")}`} onClick={onClose} className={styles.backLink}>Lịch trình</Link><h1>Trợ lý hành trình</h1></div>
      <div className={styles.headerActions}>{companion && <Link href={`/assistant?trip=${encodeURIComponent(chat.workspace?.selectedTripSlug || tripSlug || "")}${chat.workspace?.selectedConversation ? `&conversation=${chat.workspace.selectedConversation.id}` : ""}`} onClick={onClose}>Mở rộng</Link>}{onClose && <button type="button" onClick={onClose}>Đóng</button>}</div>
    </header>
    <div className={styles.toolbar}>
      <label className={styles.tripControl}><span>Chuyến đi</span><select aria-label="Chuyến đi" value={chat.workspace?.selectedTripSlug || ""} onChange={(event) => { setPanel(null); chat.selectTrip(event.target.value); }} disabled={chat.loading || chat.submitting}>
        {chat.workspace?.trips.map((trip) => <option key={trip.slug} value={trip.slug}>{trip.title}</option>)}
      </select></label>
      <div><button type="button" disabled={chat.loading} onClick={() => { setPanel("history"); void chat.history(); }}>Lịch sử</button><button type="button" disabled={chat.loading || chat.submitting} onClick={chat.newConversation}>Trò chuyện mới</button></div>
    </div>
    <div className={styles.turnList} ref={listRef} aria-label="Nội dung cuộc trò chuyện" aria-busy={chat.loading} onScroll={(event) => { const el = event.currentTarget; nearEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; if (nearEnd.current) setNewResponse(false); }}>
      {chat.loading ? <p role="status">Đang tải cuộc trò chuyện…</p> : <>
        {chat.workspace?.nextCursor && <button className={styles.secondaryButton} onClick={() => { olderAnchor.current = listRef.current.scrollHeight; void chat.older(); }}>Xem trao đổi trước</button>}
        {!chat.turns.length && <div className={styles.firstRun}><div className={styles.routeMark} aria-hidden="true"><span /><i /><span /></div><h2>Cùng lên một chuyến đi<br />vừa ý hơn.</h2><p>Hỏi về lịch trình, tìm hiểu điểm đến, hoặc chuẩn bị thay đổi. Bạn luôn là người quyết định.</p>
          <div>{["Tóm tắt lịch và các khoảng thời gian gấp", "Kiểm tra giờ mở cửa của một địa điểm", "So sánh cách đi giữa hai hoạt động"].map((prompt) => <button key={prompt} onClick={() => { chat.setMessage(prompt); document.getElementById("assistant-message")?.focus(); }}>{prompt}</button>)}</div></div>}
        {chat.turns.map((turn) => <article key={turn.id} className={styles.turn} aria-label={`Lượt trao đổi: ${turn.input}`}>
          <div className={styles.userMessage}><span>Bạn</span><p>{turn.input}</p></div>
          <div className={styles.assistantMessage}><span>Trợ lý</span>
            {turn.output && <MessageContent text={turn.output} citations={turn.citations} onCitation={(citation) => inspect(turn, "evidence", citation)} />}
            {turn.status === "running" && <p className={styles.running} role="status">{chat.progress || "Đang trả lời…"}</p>}
            {turn.status === "failed" && <div className={styles.interrupted}><p>{turn.errorCode === "TURN_CANCELLED" ? "Đã dừng trả lời." : "Câu trả lời chưa hoàn tất."} Lịch chưa được thay đổi bởi yêu cầu này.</p><button disabled={running} onClick={() => chat.send(turn.input)}>Thử lại yêu cầu</button></div>}
            <div className={styles.messageActions}>
              {!!turn.citations?.length && <button onClick={() => inspect(turn, "evidence")}>Nguồn · {turn.citations.length}</button>}
              {turn.changeSet && <button data-status={turn.changeSet.status} className={styles.reviewButton} onClick={() => inspect(turn, "changes")}>{turn.changeSet.status === "applied" ? "Xem thay đổi đã áp dụng" : ["expired", "conflicted"].includes(turn.changeSet.status) ? "Xem đề xuất không còn hiệu lực" : `Xem ${turn.changeSet.preview.changes.length} thay đổi được đề xuất`}</button>}
            </div>
          </div>
        </article>)}
      </>}
    </div>
    {newResponse && <button className={styles.newResponse} onClick={() => { nearEnd.current = true; listRef.current.scrollTop = listRef.current.scrollHeight; setNewResponse(false); }}>Có câu trả lời mới</button>}
    {chat.error && <div role="alert" className={styles.errorBanner}>{chat.error}<button onClick={() => chat.load({ trip: chat.workspace?.selectedTripSlug, conversation: chat.workspace?.selectedConversation?.id, replace: true })}>Kết nối lại</button></div>}
    <Composer message={chat.message} setMessage={chat.setMessage} onSubmit={chat.submit} onStop={chat.stop} running={running} disabled={chat.submitting || chat.loading || !chat.workspace?.selectedTripSlug} />
    {panel && <Dialog onClose={() => setPanel(null)} pending={applying} overlayClassName={styles.overlay} initialFocusRef={citationFocus}><section className={styles.inspection}><header><DialogTitle>{panel === "history" ? "Lịch sử trò chuyện" : panel === "evidence" ? "Nguồn tham khảo" : "Xem lại thay đổi"}</DialogTitle><button disabled={applying} onClick={() => setPanel(null)}>Đóng</button></header>
      {panel === "history" ? <ConversationHistory conversations={chat.workspace?.conversations || []} selectedId={chat.workspace?.selectedConversation?.id} allTrips={chat.allTrips} onFilter={(all) => chat.history(false, all)} onMore={() => chat.history(true)} hasMore={!!chat.workspace?.historyCursor} onNew={() => { setPanel(null); chat.newConversation(); }} onSelect={(conversation) => { setPanel(null); chat.selectConversation(conversation); }} />
        : panel === "evidence" ? <EvidencePanel focusId={focusCitation.current} focusRef={citationFocus} citations={selected?.citations || []} /> : <ChangePanel changeSet={changeSet} busy={applying} onConfirm={confirm} onRegenerate={() => { setPanel(null); chat.setMessage(`Tạo lại đề xuất từ lịch mới nhất: ${selected.input}`); }} />}
    </section></Dialog>}
  </section>;
}
