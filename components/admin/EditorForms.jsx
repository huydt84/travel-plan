import { useId, useRef, useState } from "react";
import { calendarDayDifference } from "../../lib/trip-dates.mjs";
import { normalizeScheduleRefs } from "../../lib/schedule-editor-state.mjs";
import { ActionIcon } from "../Icons";

const emptySource = { title: "", url: "" };
const ACTIVITY_TYPES = [
  { value: "Transit", label: "Di chuyển", icon: "🚆" },
  { value: "Walk", label: "Đi bộ", icon: "🚶" },
  { value: "Visit", label: "Tham quan", icon: "📍" },
  { value: "Film", label: "Quay phim / chụp ảnh", icon: "🎬📷" },
  { value: "Buffer", label: "Thời gian đệm", icon: "🧊" },
  { value: "Rest", label: "Nghỉ", icon: "☕" },
  { value: "Cafe", label: "Quán cà phê", icon: "☕" },
  { value: "Lunch", label: "Ăn trưa", icon: "🍜" },
  { value: "Dinner", label: "Ăn tối", icon: "🍽️" },
  { value: "Picnic", label: "Picnic / Cắm trại", icon: "🧺" },
  { value: "Indoor", label: "Trong nhà", icon: "🏠" },
];
const ACTIVITY_ICONS = [
  { value: "🚆", label: "Tàu / di chuyển" },
  { value: "🚃", label: "Tàu điện / Enoden" },
  { value: "🚶", label: "Đi bộ" },
  { value: "📍", label: "Địa điểm" },
  { value: "🎬📷", label: "Quay phim / chụp ảnh" },
  { value: "🧊", label: "Thời gian đệm" },
  { value: "☕", label: "Nghỉ / cà phê" },
  { value: "🍜", label: "Món ăn" },
  { value: "🍽️", label: "Bữa ăn" },
  { value: "🧺", label: "Picnic / cắm trại" },
  { value: "🏠", label: "Trong nhà" },
  { value: "⛩️", label: "Đền / chùa" },
  { value: "🏛️", label: "Điểm tham quan" },
];

const includeCurrentOption = (options, value, label = value) => (
  value && !options.some((option) => option.value === value)
    ? [{ value, label: `${label} · đang dùng` }, ...options]
    : options
);

const openTimePicker = (event) => {
  try {
    event.currentTarget.showPicker?.();
  } catch {
    // Browsers without a programmable native picker still keep the normal time input behavior.
  }
};

export function TripForm({ editor, busy, onSave, onCancel }) {
  const [values, setValues] = useState({ ...editor.values, moveSchedule: Boolean(editor.originalSlug) });
  const field = (name) => ({ value: values[name] || "", onChange: (event) => setValues({ ...values, [name]: event.target.value }) });
  const datesChanged = Boolean(editor.originalSlug && (values.startDate !== editor.values.startDate || values.endDate !== editor.values.endDate));
  const canMoveSchedule = datesChanged
    && values.startDate && values.endDate
    && calendarDayDifference(editor.values.startDate, editor.values.endDate) === calendarDayDifference(values.startDate, values.endDate);
  const changeStartDate = (event) => {
    const startDate = event.target.value;
    const endDate = !values.endDate || values.endDate === values.startDate ? startDate : values.endDate;
    setValues({ ...values, startDate, endDate });
  };
  return (
    <form className="admin-editor admin-form" onSubmit={(event) => { event.preventDefault(); onSave({ ...values, moveSchedule: canMoveSchedule && values.moveSchedule }, editor.originalSlug); }}>
      <div className="admin-section-head"><h2>{editor.originalSlug ? "Sửa trip" : "Trip mới"}</h2><button type="button" className="admin-ghost" onClick={onCancel}>Đóng</button></div>
      <div className="form-grid"><label>Slug<input {...field("slug")} placeholder="tokyo-2026-08-10" required /></label><label>Tên trip<input {...field("title")} required /></label><label>Ngày bắt đầu<input type="date" value={values.startDate || ""} onChange={changeStartDate} required /></label><label>Ngày kết thúc<input type="date" {...field("endDate")} min={values.startDate || undefined} required /></label><label>Timezone<input {...field("timezone")} required /></label><label className="wide">Địa điểm<input {...field("location")} required /></label></div>
      {canMoveSchedule && <label className="trip-shift-option"><input type="checkbox" checked={values.moveSchedule} onChange={(event) => setValues({ ...values, moveSchedule: event.target.checked })} /><span><strong>Dời toàn bộ lịch theo khoảng ngày mới</strong><small>Các hoạt động và phương án sẽ giữ nguyên ngày tương đối.</small></span></label>}
      {datesChanged && !canMoveSchedule && <p className="form-guidance">Thời lượng chuyến đi đã đổi. Hoạt động hiện có giữ nguyên ngày; hệ thống sẽ báo nếu có mục nằm ngoài khoảng mới.</p>}
      <button className="admin-primary" disabled={busy}>{busy ? "Đang lưu…" : "Lưu trip"}</button>
    </form>
  );
}

export function ScheduleForm({ editor, busy, error, sources, placement, onChange, onCreateSource, onSave, onCancel }) {
  const values = editor.values;
  const field = (name) => ({ value: values[name] ?? "", onChange: (event) => onChange({ ...values, [name]: event.target.value }) });
  const typeOptions = includeCurrentOption(ACTIVITY_TYPES, values.type);
  const iconOptions = includeCurrentOption(ACTIVITY_ICONS, values.icon, values.icon);
  const changeType = (event) => {
    const nextType = event.target.value;
    const currentDefaultIcon = ACTIVITY_TYPES.find((option) => option.value === values.type)?.icon;
    const nextDefaultIcon = ACTIVITY_TYPES.find((option) => option.value === nextType)?.icon;
    onChange({
      ...values,
      type: nextType,
      icon: !values.icon || values.icon === currentDefaultIcon ? nextDefaultIcon : values.icon,
    });
  };
  return (
    <form id={`schedule-editor-${editor.key}`} className={`admin-editor admin-form schedule-editor ${placement === "inline" ? "schedule-inline-editor" : "schedule-create-editor"}`} onSubmit={(event) => { event.preventDefault(); onSave(values, values.id); }}>
      <div className="admin-section-head schedule-editor-head">
        <h2 tabIndex="-1" data-editor-heading>{values.id ? `Sửa: ${values.title || "Hoạt động"}` : "Hoạt động mới"}</h2>
        <button type="button" className="admin-ghost" onClick={onCancel} disabled={busy}>Hủy</button>
      </div>
      <div className="form-grid schedule-form-grid">
        <label className="schedule-field schedule-date-field">Ngày bắt đầu<input type="date" {...field("startDate")} required /></label>
        <label className="schedule-field schedule-time-field">Bắt đầu<input type="time" {...field("start")} onClick={openTimePicker} required /></label>
        <label className="schedule-field schedule-date-field">Ngày kết thúc<input type="date" {...field("endDate")} min={values.startDate || undefined} required /></label>
        <label className="schedule-field schedule-time-field">Kết thúc<input type="time" {...field("end")} onClick={openTimePicker} required /></label>
        <label className="schedule-field schedule-display-field">Hiển thị kết thúc<input {...field("displayEnd")} placeholder="Tuỳ chọn, ví dụ +" /></label>
        <label className="schedule-field schedule-type-field">Loại
          <select value={values.type || ""} onChange={changeType} required>
            {typeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="schedule-field schedule-icon-field">Icon
          <select {...field("icon")} required>
            {iconOptions.map((option) => <option value={option.value} key={option.value}>{option.value} · {option.label}</option>)}
          </select>
        </label>
        <label className="wide schedule-field schedule-title-field">Tiêu đề<input {...field("title")} required /></label>
        <label className="wide schedule-field schedule-detail-field"><span>Chi tiết <small className="field-optional">Không bắt buộc</small></span><textarea {...field("detail")} rows="3" /></label>
      </div>
      {values.startDate && values.endDate && values.endDate !== values.startDate && <p className="overnight-note"><ActionIcon name="moon" /> Hoạt động kết thúc vào ngày hôm sau.</p>}
      <SourcePicker
        sources={sources}
        selectedRefs={values.refs}
        onChange={(refs) => onChange({ ...values, refs })}
        onCreateSource={onCreateSource}
      />
      {error && <p className="form-error schedule-form-error" role="alert">{error}</p>}
      <div className="schedule-editor-actions">
        <button type="button" className="admin-ghost" onClick={onCancel} disabled={busy}>Hủy</button>
        <button className="admin-primary" disabled={busy}>{busy ? "Đang lưu…" : values.id ? "Lưu thay đổi" : "Thêm hoạt động"}</button>
      </div>
    </form>
  );
}

function SourcePicker({ sources, selectedRefs, onChange, onCreateSource }) {
  const [addingSource, setAddingSource] = useState(false);
  const [creatingSource, setCreatingSource] = useState(false);
  const [createdNotice, setCreatedNotice] = useState("");
  const refs = normalizeScheduleRefs(selectedRefs);
  const toggleSource = (number) => {
    const next = refs.includes(number) ? refs.filter((ref) => ref !== number) : [...refs, number];
    onChange(normalizeScheduleRefs(next));
  };
  const createAndSelectSource = async (values) => {
    setCreatingSource(true);
    try {
      const source = await onCreateSource(values);
      onChange(normalizeScheduleRefs([...refs, source.number]));
      setAddingSource(false);
      setCreatedNotice(`Đã thêm và chọn “${source.title}”.`);
      return source;
    } finally {
      setCreatingSource(false);
    }
  };
  return (
    <fieldset className="source-picker">
      <legend>Nguồn tham khảo</legend>
      <div className="source-picker-frame">
        <div className="source-picker-head">
          <p>{sources.length ? "Chọn các nguồn xác nhận thông tin cho hoạt động này." : "Chuyến đi này chưa có nguồn tham khảo."}</p>
          {!addingSource && <button type="button" className="admin-ghost" onClick={() => { setAddingSource(true); setCreatedNotice(""); }}>{sources.length ? "Thêm nguồn mới" : "Thêm nguồn đầu tiên"}</button>}
        </div>
        {sources.length > 0 && (
          <div className="source-picker-list">
            {sources.map((source) => (
              <label className="source-option" key={source.number}>
                <input type="checkbox" checked={refs.includes(source.number)} onChange={() => toggleSource(source.number)} disabled={creatingSource} />
                <span className="source-option-number">{String(source.number).padStart(2, "0")}</span>
                <span className="source-option-copy"><strong>{source.title}</strong><small>{source.host}</small></span>
              </label>
            ))}
          </div>
        )}
        {addingSource && <SourceForm compact onSave={createAndSelectSource} onCancel={() => setAddingSource(false)} />}
        {createdNotice && <p className="source-created-notice" role="status">{createdNotice}</p>}
      </div>
    </fieldset>
  );
}

export function SourceForm({ compact = false, source = null, onSave, onCancel }) {
  const [values, setValues] = useState(source ? { title: source.title, url: source.url } : emptySource);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fieldsRef = useRef(null);
  const hintId = useId();
  const field = (name) => ({ value: values[name], onChange: (event) => setValues({ ...values, [name]: event.target.value }) });
  const submitSource = async (event) => {
    event?.preventDefault?.();
    if (compact) {
      if (!values.title.trim()) { setError("Hãy nhập tên nguồn."); fieldsRef.current?.querySelector("input")?.focus(); return; }
      try {
        const parsed = new URL(values.url);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch { setError("URL phải bắt đầu bằng http:// hoặc https://."); fieldsRef.current?.querySelectorAll("input")?.[1]?.focus(); return; }
    }
    setBusy(true); setError("");
    try { await onSave(values); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  const fields = (
    <div className={compact ? "source-inline-fields" : "form-grid"} ref={fieldsRef}>
      <label className={compact ? "" : "wide"}>Tên nguồn<input {...field("title")} maxLength={300} placeholder="Ví dụ: Trang chính thức của bảo tàng" required={!compact} /></label>
      <label className={compact ? "" : "wide"}>URL<input type={compact ? "text" : "url"} inputMode="url" autoCapitalize="none" spellCheck={false} {...field("url")} maxLength={2000} placeholder="https://example.com/dia-diem" aria-describedby={hintId} required={!compact} /><small id={hintId}>Tên miền và số nguồn được tạo tự động.</small></label>
    </div>
  );
  if (compact) {
    return (
      <section className="source-inline-form" onKeyDown={(event) => { if (event.key === "Enter" && event.target.tagName === "INPUT") submitSource(event); }}>
        <div className="source-inline-head"><strong>Thêm nguồn mới</strong><button type="button" className="admin-ghost" onClick={onCancel}>Hủy</button></div>
        {fields}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="button" className="admin-primary" onClick={submitSource} disabled={busy}>{busy ? "Đang thêm…" : "Thêm và chọn nguồn"}</button>
      </section>
    );
  }
  return (
    <form className="admin-editor admin-form source-form" onSubmit={submitSource}>
      <div className="admin-section-head"><h2>{source ? `Sửa nguồn ${source.number}` : "Nguồn mới"}</h2><button type="button" className="admin-ghost" onClick={onCancel}>Hủy</button></div>
      {fields}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="admin-primary" disabled={busy}>{busy ? "Đang lưu…" : source ? "Lưu nguồn" : "Thêm nguồn"}</button>
    </form>
  );
}

