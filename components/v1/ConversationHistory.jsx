import styles from "./assistant.module.css";
export default function ConversationHistory({ conversations, selectedId, onSelect, onMore, hasMore, loading, error, onRetry }) {
  return <div className={styles.history}>
    {error && <div role="alert"><p>{error}</p><button className={styles.secondaryButton} onClick={onRetry}>Thử lại</button></div>}
    {loading && <p role="status">Đang tải hội thoại…</p>}
    <nav aria-label="Lịch sử trò chuyện">{conversations.map((conversation) => <button key={conversation.id} type="button" aria-current={conversation.id === selectedId ? "page" : undefined} onClick={() => onSelect(conversation)}>
      <strong>{conversation.title}</strong><span>{conversation.pins?.length ? `${conversation.pins.length} ngữ cảnh đã ghim` : ""}</span><small>{conversation.status === "running" ? "Đang trả lời" : conversation.status === "awaiting_approval" ? "Cần phê duyệt" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(conversation.updatedAt))}</small>
    </button>)}</nav>
    {!loading && !error && !conversations.length && <p>Chưa có cuộc trò chuyện. Bắt đầu bằng một câu hỏi hoặc tìm kiếm.</p>}
    {hasMore && <button className={styles.secondaryButton} disabled={loading} onClick={onMore}>Xem thêm cuộc trò chuyện</button>}
  </div>;
}
