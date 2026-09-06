import styles from "./assistant.module.css";

const labels = { slug: "Đường dẫn", title: "Tên", name: "Tên địa điểm", startDate: "Ngày bắt đầu", endDate: "Ngày kết thúc", start: "Giờ bắt đầu", end: "Giờ kết thúc", timezone: "Múi giờ", location: "Khu vực", address: "Địa chỉ", latitude: "Vĩ độ", longitude: "Kinh độ", website: "Website", googlePlaceId: "Google Maps ID", notes: "Ghi chú", detail: "Chi tiết", sources: "Nguồn liên kết", place: "Địa điểm liên kết", branchId: "Nhánh", key: "Mã hoạt động", url: "URL", host: "Website nguồn", number: "Số nguồn", type: "Loại", icon: "Biểu tượng", displayEnd: "Giờ kết thúc hiển thị" };
const kinds = { trip: "Chuyến đi", activity: "Hoạt động", source: "Nguồn", place: "Địa điểm" };
export const batchStatus = { pending: "Cần phê duyệt", applied: "Đã lưu", rejected: "Đã từ chối", expired: "Đã hết hạn", conflicted: "Dữ liệu đã thay đổi", cancelled: "Đã dừng", failed: "Không lưu được" };
const display = (v) => Array.isArray(v) ? v.join(", ") || "Không có" : v == null || v === "" ? "Không có" : typeof v === "object" ? JSON.stringify(v) : String(v);

export default function BatchReview({ action, busy = false, readOnly = false, onApprove, onReject, onRevise }) {
  const pending = action.status === "pending";
  return <section className={styles.batchReview} aria-label="Yêu cầu thay đổi" data-status={action.status} aria-busy={busy}>
    <div className={styles.batchSummary} role="status"><h3>{busy ? "Đang xử lý…" : batchStatus[action.status]}</h3><p>{action.preview.summary}</p>
      {pending && <p>Chưa có thay đổi nào được lưu. Phê duyệt sẽ lưu toàn bộ nhóm cùng lúc.</p>}
      {action.status === "failed" && <p>Toàn bộ nhóm đã được hoàn tác. Tạo lại đề xuất để thử lại.</p>}
    </div>
    <details className={styles.batchDetails}><summary>Xem {action.preview.changes.length} thay đổi</summary>
    {action.preview.groups.map((group) => <section className={styles.batchGroup} key={group.tripKey} aria-label={group.title}>
      <h3>{group.title}</h3>
      {Object.entries(kinds).map(([kind, label]) => {
        const changes = action.preview.changes.filter((c) => c.tripKey === group.tripKey && c.kind.startsWith(kind + "."));
        return changes.length ? <details open key={kind}><summary>{label} ({changes.length})</summary>
          {changes.map((change) => <article key={change.targetKey} className={styles.batchChange}>
            <h4>{change.before ? "Cập nhật" : "Tạo"}: {change.title}</h4>
            <dl>{Object.keys(labels).filter((field) => Object.hasOwn(change.after, field)).map((field) => [field, change.after[field]]).filter(([field, value]) => !change.before || display(change.before[field]) !== display(value)).map(([field, value]) => <div className={styles.batchField} key={field}>
              <dt>{labels[field] || field}</dt><dd>{change.before && <div><span>Trước</span><del>{display(change.before[field])}</del></div>}<div>{change.before && <span>Sau</span>}<ins>{display(value)}</ins></div></dd>
            </div>)}</dl>
          </article>)}
        </details> : null;
      })}
    </section>)}
    </details>
    {action.receipt && <div className={styles.batchReceipt}><h3>Tài nguyên đã lưu</h3><ul>{action.receipt.resources.map((resource) => <li key={`${resource.kind}:${resource.id}`}><a href={resource.href}>{resource.title}</a><span>{kinds[resource.kind]}</span></li>)}</ul></div>}
    {readOnly ? <p>Chỉ xem. Người tạo cuộc trò chuyện mới có thể phê duyệt.</p> : pending ? <div className={styles.batchApproval}>
      <p>Phê duyệt chỉ có hiệu lực cho nhóm này. Hết hạn: {new Date(action.expiresAt).toLocaleString("vi-VN")}</p>
      <div><button className={styles.applyButton} disabled={busy || !action.confirmationToken} onClick={onApprove}>{busy ? "Đang xử lý…" : "Phê duyệt thay đổi"}</button><button className={styles.secondaryButton} disabled={busy} onClick={onReject}>Từ chối</button></div>
    </div> : action.status !== "applied" && onRevise ? <button className={styles.secondaryButton} onClick={onRevise}>Tạo lại đề xuất</button> : null}
  </section>;
}
