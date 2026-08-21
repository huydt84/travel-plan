"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import styles from "./assistant.module.css";

const apiJson = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...options.headers } : options.headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.code = data.code;
    error.retryable = data.retryable;
    throw error;
  }
  return data;
};

const readEvents = async (response, onEvent) => {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.code = data.code;
    throw error;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Trình duyệt không hỗ trợ luồng phản hồi");
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split("\n");
    pending = lines.pop() || "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
    if (done) break;
  }
  if (pending.trim()) onEvent(JSON.parse(pending));
};

const formatCheckedAt = (value) => value
  ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
  : "Không rõ";

const fieldLabels = {
  start: "Bắt đầu", end: "Kết thúc", displayEnd: "Giờ hiển thị", type: "Loại",
  icon: "Biểu tượng", title: "Tên", detail: "Chi tiết", refs: "Nguồn", branchId: "Nhánh", key: "Mã ổn định",
};

const displayValue = (value) => {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Không có";
  if (value == null || value === "") return "—";
  return String(value);
};

export default function AssistantWorkspace({ initialWorkspace, viewer }) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [turns, setTurns] = useState(initialWorkspace.turns || []);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [inspector, setInspector] = useState(initialWorkspace.turns?.at(-1)?.changeSet ? "changes" : "evidence");
  const [selectedTurnId, setSelectedTurnId] = useState(initialWorkspace.turns?.at(-1)?.id || null);
  const [mobilePanel, setMobilePanel] = useState(null);
  const composerRef = useRef(null);
  const selectedTurn = turns.find((turn) => turn.id === selectedTurnId) || turns.at(-1) || null;
  const activeChangeSet = selectedTurn?.changeSet || null;
  const selectedKeys = new Set(activeChangeSet?.preview?.changes?.map((change) => change.targetKey) || []);
  const stationSignalClass = activeChangeSet?.status === "applied"
    ? styles.appliedStation
    : ["conflicted", "expired"].includes(activeChangeSet?.status)
      ? styles.staleStation
      : styles.affectedStation;

  const routeItems = useMemo(() => workspace.snapshot?.itinerary || [], [workspace.snapshot]);

  const loadWorkspace = async ({ trip = workspace.selectedTripSlug, conversation = null } = {}) => {
    setError("");
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (trip) params.set("trip", trip);
      if (conversation) params.set("conversation", conversation);
      const next = await apiJson(`/api/v1/assistant/workspace?${params}`);
      setWorkspace(next);
      setTurns(next.turns || []);
      setSelectedTurnId(next.turns?.at(-1)?.id || null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setBusy(false);
    }
  };

  const beginConversation = async () => {
    setTurns([]);
    setSelectedTurnId(null);
    setWorkspace((current) => ({ ...current, selectedConversation: null }));
    setError("");
    setProgress("");
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const submitTurn = async (event) => {
    event.preventDefault();
    const input = message.trim();
    if (!input || busy || !workspace.selectedTripSlug) return;
    const clientTurnId = crypto.randomUUID();
    const optimistic = { id: clientTurnId, input, output: null, citations: [], status: "running", changeSet: null };
    setTurns((current) => [...current, optimistic]);
    setSelectedTurnId(clientTurnId);
    setMessage("");
    setError("");
    setProgress("Đang tiếp nhận yêu cầu");
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/trips/${encodeURIComponent(workspace.selectedTripSlug)}/assistant/turns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: workspace.selectedConversation?.id || null, clientTurnId, message: input }),
      });
      await readEvents(response, (streamEvent) => {
        if (streamEvent.type === "accepted") {
          setWorkspace((current) => ({
            ...current,
            selectedConversation: current.selectedConversation || { id: streamEvent.conversationId, tripSlug: current.selectedTripSlug, title: input },
          }));
        }
        if (streamEvent.type === "progress") setProgress(streamEvent.label);
        if (streamEvent.type === "completed") {
          setTurns((current) => current.map((turn) => turn.id === clientTurnId ? streamEvent.turn : turn));
          setSelectedTurnId(streamEvent.turn.id);
          if (streamEvent.turn.changeSet) setInspector("changes");
          setProgress("");
        }
        if (streamEvent.type === "failed") throw Object.assign(new Error(streamEvent.error.message), { code: streamEvent.error.code });
      });
    } catch (turnError) {
      setTurns((current) => current.filter((turn) => turn.id !== clientTurnId));
      setError(turnError.message);
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  const confirmProposal = async () => {
    if (!activeChangeSet?.confirmationToken || busy) return;
    setBusy(true);
    setError("");
    setProgress("Đang khóa phiên bản lịch và áp dụng thay đổi");
    try {
      const receipt = await apiJson(`/api/v1/assistant/proposals/${activeChangeSet.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ confirmationToken: activeChangeSet.confirmationToken }),
      });
      setTurns((current) => current.map((turn) => turn.id === selectedTurn.id
        ? { ...turn, changeSet: { ...turn.changeSet, status: "applied", receipt, confirmationToken: null } }
        : turn));
      setProgress("");
    } catch (commitError) {
      setError(commitError.message);
      if (["PLAN_CONFLICT", "PROPOSAL_EXPIRED"].includes(commitError.code)) {
        setTurns((current) => current.map((turn) => turn.id === selectedTurn.id
          ? { ...turn, changeSet: { ...turn.changeSet, status: commitError.code === "PLAN_CONFLICT" ? "conflicted" : "expired", confirmationToken: null } }
          : turn));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/">LỊCH TRÌNH <span>/V1</span></Link>
        <div className={styles.tripControl}>
          <label htmlFor="assistant-trip">Chuyến đi</label>
          <select id="assistant-trip" value={workspace.selectedTripSlug || ""} disabled={busy} onChange={(event) => loadWorkspace({ trip: event.target.value })}>
            {workspace.trips.map((trip) => <option key={trip.slug} value={trip.slug}>{trip.title}</option>)}
          </select>
        </div>
        <div className={styles.viewer}>{viewer.email}<strong>PILOT CHỈ ADMIN</strong></div>
      </header>

      <div className={styles.mobileToolbar} aria-label="Mở thông tin phụ">
        <button type="button" aria-expanded={mobilePanel === "route"} onClick={() => setMobilePanel(mobilePanel === "route" ? null : "route")}>Tuyến · {routeItems.length} ga</button>
        <button type="button" aria-expanded={mobilePanel === "inspector"} onClick={() => setMobilePanel(mobilePanel === "inspector" ? null : "inspector")}>Bằng chứng & thay đổi</button>
      </div>

      <div className={styles.desk}>
        <aside className={`${styles.routeRail} ${mobilePanel === "route" ? styles.mobileOpen : ""}`} aria-label="Tuyến và cuộc trò chuyện">
          <div className={styles.routeHeading}>
            <h1>{workspace.snapshot?.trip?.title || "Chưa có chuyến đi"}</h1>
            <p>{workspace.snapshot?.trip?.date} · {workspace.snapshot?.trip?.location}</p>
            <span>Phiên bản kế hoạch {workspace.snapshot?.revision ?? "—"}</span>
          </div>
          <ol className={styles.routeSpine}>
            {routeItems.map((item) => (
              <li key={item.key} className={selectedKeys.has(item.key) ? stationSignalClass : ""}>
                <time>{item.start}</time><i aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.type}</small></span>
              </li>
            ))}
          </ol>
          <div className={styles.conversationSection}>
            <div><h2>Trao đổi gần đây</h2><button type="button" onClick={beginConversation} disabled={busy}>Cuộc trò chuyện mới</button></div>
            {workspace.conversations.length ? (
              <nav aria-label="Lịch sử trò chuyện">
                {workspace.conversations.map((conversation) => (
                  <button key={conversation.id} type="button" disabled={busy} aria-current={workspace.selectedConversation?.id === conversation.id ? "page" : undefined} onClick={() => loadWorkspace({ conversation: conversation.id })}>
                    <span>{conversation.title}</span><small>{conversation.tripTitle}</small>
                  </button>
                ))}
              </nav>
            ) : <p className={styles.emptyCopy}>Câu hỏi đầu tiên sẽ mở một cuộc trò chuyện riêng cho chuyến này.</p>}
          </div>
        </aside>

        <section className={styles.workstream} aria-labelledby="assistant-heading">
          <div className={styles.workstreamHeading}>
            <div><h2 id="assistant-heading">Hỏi, nghiên cứu, rồi quyết định</h2><p>Trợ lý có thể chuẩn bị thay đổi nhưng không thể tự áp dụng lịch.</p></div>
            <span>{workspace.limits.maxToolExecutions} lượt công cụ tối đa</span>
          </div>

          <div className={styles.turnList} aria-live="polite">
            {!turns.length && (
              <div className={styles.firstRun}>
                <h3>Bắt đầu từ lịch đang có</h3>
                <p>Hỏi giờ mở cửa, đánh giá, cách đi, hoặc yêu cầu chuẩn bị một thay đổi cụ thể. Mọi thay đổi sẽ xuất hiện ở bàn kiểm tra trước khi có thể áp dụng.</p>
                <div>
                  {["Tóm tắt lịch và các khoảng thời gian gấp", "Kiểm tra giờ mở cửa của một địa điểm", "So sánh cách đi giữa hai hoạt động"].map((prompt) => (
                    <button key={prompt} type="button" onClick={() => { setMessage(prompt); composerRef.current?.focus(); }}>{prompt}</button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((turn) => (
              <article
                key={turn.id}
                className={`${styles.turn} ${selectedTurnId === turn.id ? styles.selectedTurn : ""}`}
                tabIndex="0"
                aria-label={`Lượt trao đổi: ${turn.input}`}
                onFocus={() => setSelectedTurnId(turn.id)}
                onClick={() => setSelectedTurnId(turn.id)}
                onKeyDown={(event) => {
                  if (["Enter", " "].includes(event.key)) {
                    event.preventDefault();
                    setSelectedTurnId(turn.id);
                  }
                }}
              >
                <div className={styles.userMessage}><span>Bạn</span><p>{turn.input}</p></div>
                {turn.status === "running" ? (
                  <div className={styles.skeleton} aria-label="Đang tạo câu trả lời"><i /><i /><i /></div>
                ) : (
                  <div className={styles.assistantMessage}>
                    <span>Trợ lý</span><p>{turn.output}</p>
                    {turn.citations?.length > 0 && <div className={styles.citationRow}>{turn.citations.map((citation) => <a key={citation.id} href={citation.url} target="_blank" rel="noreferrer">[{citation.id}] {citation.title}</a>)}</div>}
                    {turn.changeSet && <button className={styles.reviewButton} data-status={turn.changeSet.status} type="button" onClick={() => { setSelectedTurnId(turn.id); setInspector("changes"); setMobilePanel("inspector"); }}>
                      {turn.changeSet.status === "applied"
                        ? `Xem ${turn.changeSet.preview.changes.length} thay đổi đã áp dụng`
                        : ["conflicted", "expired"].includes(turn.changeSet.status)
                          ? "Xem đề xuất không còn hiệu lực"
                          : `Xem ${turn.changeSet.preview.changes.length} thay đổi được đề xuất`}
                    </button>}
                  </div>
                )}
              </article>
            ))}
          </div>

          {(progress || error) && <div className={error ? styles.errorBanner : styles.progressBanner} role={error ? "alert" : "status"}>{error || progress}</div>}
          <form className={styles.composer} onSubmit={submitTurn}>
            <label htmlFor="assistant-message">Yêu cầu cho trợ lý</label>
            <textarea ref={composerRef} id="assistant-message" rows="3" value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} placeholder="Ví dụ: Kiểm tra giờ mở cửa rồi đề xuất dời hoạt động này…" />
            <div><span>Enter để xuống dòng · câu trả lời không tự sửa lịch</span><button className={styles.primaryButton} type="submit" disabled={busy || !message.trim()}>{busy ? "Đang làm việc…" : "Gửi yêu cầu"}</button></div>
          </form>
        </section>

        <aside className={`${styles.inspector} ${mobilePanel === "inspector" ? styles.mobileOpen : ""}`} aria-label="Bằng chứng và thay đổi">
          <div className={styles.inspectorTabs} role="tablist">
            <button role="tab" aria-selected={inspector === "evidence"} onClick={() => setInspector("evidence")}>Bằng chứng</button>
            <button role="tab" aria-selected={inspector === "changes"} onClick={() => setInspector("changes")}>Thay đổi {activeChangeSet ? `(${activeChangeSet.preview.changes.length})` : ""}</button>
          </div>
          {inspector === "evidence" ? <EvidencePanel citations={selectedTurn?.citations || []} /> : <ChangePanel changeSet={activeChangeSet} busy={busy} onConfirm={confirmProposal} onRegenerate={() => { setMobilePanel(null); setMessage("Tạo lại đề xuất từ lịch mới nhất và giải thích mọi thay đổi"); composerRef.current?.focus(); }} />}
        </aside>
      </div>
    </main>
  );
}

function EvidencePanel({ citations }) {
  if (!citations.length) return <div className={styles.inspectorEmpty}><h3>Chưa có bằng chứng ngoài</h3><p>Nguồn web, dữ liệu địa điểm và tuyến đường sẽ xuất hiện ở đây, kèm thời điểm kiểm tra.</p></div>;
  return <div className={styles.evidenceList}>{citations.map((citation) => (
    <article key={citation.id}>
      <span>{citation.id} · {citation.kind === "route" ? "TUYẾN" : citation.kind === "place" ? "GOOGLE MAPS" : "NGUỒN"}</span>
      <h3>{citation.title}</h3>
      <p>{citation.publisher || citation.host || "Nguồn bên ngoài"}</p>
      <time>Kiểm tra {formatCheckedAt(citation.checkedAt)}</time>
      <a href={citation.url} target="_blank" rel="noreferrer">Mở nguồn gốc</a>
    </article>
  ))}</div>;
}

function ChangePanel({ changeSet, busy, onConfirm, onRegenerate }) {
  if (!changeSet) return <div className={styles.inspectorEmpty}><h3>Không có thay đổi đang chờ</h3><p>Khi bạn yêu cầu sửa lịch, trợ lý chỉ tạo một bản đề xuất bất biến để bạn kiểm tra tại đây.</p></div>;
  const applicable = changeSet.status === "staged" && changeSet.confirmationToken;
  const statusTitle = changeSet.status === "applied"
    ? `${changeSet.preview.changes.length} thay đổi đã áp dụng`
    : ["conflicted", "expired"].includes(changeSet.status)
      ? "Đề xuất không còn hiệu lực"
      : changeSet.preview.summary;
  return (
    <div className={styles.changePanel}>
      <div className={styles.changeSummary} data-status={changeSet.status}>
        <h3>{statusTitle}</h3>
        <p>So với phiên bản {changeSet.baseRevision} · hết hạn {formatCheckedAt(changeSet.expiresAt)}</p>
      </div>
      {changeSet.preview.warnings?.map((warning) => <p className={styles.warning} key={warning}>{warning}</p>)}
      <div className={styles.changeList}>
        {changeSet.preview.changes.map((change, index) => <Change key={`${change.targetKey}-${index}`} change={change} />)}
      </div>
      {changeSet.receipt ? (
        <div className={styles.receipt} role="status"><strong>Đã áp dụng nguyên tử</strong><span>Phiên bản {changeSet.receipt.fromRevision} → {changeSet.receipt.toRevision}</span><Link href={`/?trip=${encodeURIComponent(changeSet.receipt.tripSlug)}`}>Mở lịch hiện tại</Link></div>
      ) : applicable ? (
        <button className={styles.applyButton} type="button" disabled={busy} onClick={onConfirm}>Áp dụng {changeSet.preview.changes.length} thay đổi</button>
      ) : (
        <div className={styles.staleAction}><p>Đề xuất này đã hết hạn hoặc lịch đã đổi. Không thể áp dụng.</p><button type="button" onClick={onRegenerate}>Tạo lại đề xuất từ lịch mới nhất</button></div>
      )}
      <p className={styles.digest}>Dấu vết: {changeSet.digest.slice(0, 12)}…</p>
    </div>
  );
}

function Change({ change }) {
  const fields = [...new Set([...Object.keys(change.before || {}), ...Object.keys(change.after || {})])]
    .filter((field) => displayValue(change.before?.[field]) !== displayValue(change.after?.[field]));
  return (
    <article className={change.destructive ? styles.destructiveChange : ""}>
      <header><span>{change.kind === "activity.add" ? "THÊM" : change.kind === "activity.remove" ? "XOÁ" : change.kind === "source.add" ? "NGUỒN MỚI" : "CẬP NHẬT"}</span><h4>{change.title}</h4></header>
      {fields.map((field) => (
        <dl key={field}><dt>{fieldLabels[field] || field}</dt><dd><del>{displayValue(change.before?.[field])}</del><ins>{displayValue(change.after?.[field])}</ins></dd></dl>
      ))}
    </article>
  );
}
