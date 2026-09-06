import Link from "next/link";
import styles from "./assistant.module.css";
const formatCheckedAt = (value) => value
  ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
  : "Không rõ";

const fieldLabels = {
  startDate: "Ngày bắt đầu", endDate: "Ngày kết thúc",
  start: "Bắt đầu", end: "Kết thúc", displayEnd: "Giờ hiển thị", type: "Loại",
  icon: "Biểu tượng", title: "Tên", detail: "Chi tiết", refs: "Nguồn", branchId: "Nhánh", key: "Mã ổn định",
};

const displayValue = (value) => {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Không có";
  if (value == null || value === "") return "—";
  return String(value);
};

export function EvidencePanel({ citations, focusId, focusRef }) {
  if (!citations.length) return <div className={styles.inspectorEmpty}><h3>Chưa có bằng chứng ngoài</h3><p>Nguồn web, dữ liệu địa điểm và tuyến đường sẽ xuất hiện ở đây, kèm thời điểm kiểm tra.</p></div>;
  return <div className={styles.evidenceList}>{citations.map((citation) => (
    <article ref={citation.id === focusId ? focusRef : undefined} tabIndex={-1} key={citation.id} id={`evidence-${citation.id}`}>
      <span>{citation.id} · {citation.kind === "route" ? "TUYẾN" : citation.kind === "place" ? "GOOGLE MAPS" : "NGUỒN"}</span>
      <h3>{citation.title}</h3>
      <p>{citation.publisher || citation.host || "Nguồn bên ngoài"}</p>
      <time>Kiểm tra {formatCheckedAt(citation.checkedAt)}</time>
      <a href={citation.url} target="_blank" rel="noreferrer">Mở nguồn gốc</a>
    </article>
  ))}</div>;
}

export function ChangePanel({ changeSet, busy, onConfirm, onRegenerate }) {
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
        <p>Chuyến đi cần sửa: <Link href={`/?trip=${encodeURIComponent(changeSet.tripSlug)}`}>{changeSet.tripTitle || changeSet.tripSlug}</Link></p>
        <p>So với phiên bản {changeSet.baseRevision} · hết hạn {formatCheckedAt(changeSet.expiresAt)}</p>
      </div>
      {changeSet.preview.warnings?.map((warning) => <p className={styles.warning} key={warning}>{warning}</p>)}
      <div className={styles.changeList}>
        {changeSet.preview.changes.map((change, index) => <Change key={`${change.targetKey}-${index}`} change={change} />)}
      </div>
      {changeSet.receipt ? (
        <div className={styles.receipt} role="status"><strong>Đã cập nhật lịch</strong><span>Phiên bản {changeSet.receipt.fromRevision} → {changeSet.receipt.toRevision}</span><Link href={`/?trip=${encodeURIComponent(changeSet.receipt.tripSlug)}`}>Mở lịch hiện tại</Link></div>
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
