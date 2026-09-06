"use client";
import BatchReview from "./v1/BatchReview";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import AdminNav from "./AdminNav";
import MessageContent from "./v1/MessageContent";
import { ReferenceList } from "./v1/ContextReferences";
import { EvidencePanel, ChangePanel } from "./v1/ProposalReview";
import { apiJson } from "./v1/transport.mjs";
import { ASSISTANT_MODELS, thinkingOptions } from "../lib/v1/assistant-policy.mjs";
import shell from "../src/styles/admin-shell.module.css";
import styles from "./assistant-management.module.css";

const effortLabel = { default: "Tự động", minimal: "Tối thiểu", low: "Thấp", medium: "Trung bình", high: "Cao" };
const date = (value) => new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(new Date(value));
const quota = (value) => value === null ? "Không giới hạn" : value;
const inherited = (policy) => policy.model === "inherit" && policy.daily === "inherit" && policy.weekly === "inherit" && policy.enabled;
const status = (turn) => turn.status === "awaiting_approval" ? "Chờ phê duyệt" : turn.status === "running" ? "Đang xử lý" : turn.status === "completed" ? "Hoàn tất" : turn.status === "failed" ? turn.errorCode === "TURN_CANCELLED" ? "Đã dừng" : "Thất bại" : "Chưa có yêu cầu";
const query = (cursor) => cursor ? `?cursor=${encodeURIComponent(JSON.stringify(cursor))}` : "";
function Rules() {
  return <details className={styles.rules}><summary>Cách tính hạn mức</summary><p>Mỗi tin nhắn hoặc lần thử lại được nhận tính một yêu cầu, kể cả khi lỗi hoặc bị dừng. Hạn mức ngày đặt lại lúc 00:00 giờ Nhật Bản; hạn mức tuần đặt lại lúc 00:00 thứ Hai. Cả hai hạn mức cùng áp dụng. Tối đa 30 yêu cầu/giờ.</p><p>Owner không chịu hạn mức ngày, tuần hoặc quyền truy cập của admin. Yêu cầu đã nhận vẫn được hoàn tất khi tắt quyền.</p></details>;
}
function Usage({ used, limit }) {
  return <div className={styles.usage}><span>{used} <span className={styles.muted}>/ {quota(limit)}</span></span>{limit !== null && <progress aria-label={`${used} trên ${limit} yêu cầu`} max={limit} value={Math.min(used,limit)} />}</div>;
}
function Badge({ enabled, children }) { return <span className={`${styles.badge} ${enabled ? styles.enabled : ""}`}>{children}</span>; }
function AccessSwitch({ policy, email, globallyEnabled=true, onSaved, onPending, onRefresh }) {
  const [pending,setPending]=useState(null),[error,setError]=useState("");
  const lock=useRef(false);
  const checked=pending ?? policy.enabled;
  const toggle=async()=>{
    if(lock.current) return;
    lock.current=true;const next=!policy.enabled;setPending(next);setError("");onPending(1);
    try {onSaved(await apiJson(`/api/admin/assistant/${email ? `admins/${encodeURIComponent(email)}` : "defaults"}`,{method:"PATCH",body:JSON.stringify({...policy,enabled:next})}));}
    catch(e){setError(e.status===409 ? "Cài đặt đã thay đổi. Hãy kiểm tra rồi thử lại." : "Chưa lưu được. Hãy thử lại.");}
    finally{lock.current=false;setPending(null);onPending(-1);void onRefresh();}
  };
  return <div className={styles.accessControl}><button type="button" role="switch" aria-checked={checked} aria-label={email ? `Cho phép ${email} dùng trợ lý` : "Cho phép tất cả admin dùng trợ lý"} aria-busy={pending!==null} disabled={pending!==null} className={styles.switchButton} onClick={toggle}><span className={styles.switchTrack} aria-hidden="true"><span /></span><span>{pending!==null ? "Đang lưu…" : checked ? "Bật" : "Tắt"}</span></button>{email && !globallyEnabled && <small>Đang bị tắt bởi quyền chung</small>}{error && <small role="alert" className={styles.switchError}>{error}</small>}</div>;
}
function Tabs({ value, onChange, items, label }) {
  return <div className={styles.tabs} role="tablist" aria-label={label}>{items.map(([id,title]) => <button key={id} role="tab" aria-selected={value===id} tabIndex={value===id ? 0 : -1} onClick={() => onChange(id)} onKeyDown={(event) => {
    if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
    event.preventDefault(); const index=items.findIndex(([key])=>key===id);
    const next=event.key==="Home" ? 0 : event.key==="End" ? items.length-1 : (index+(event.key==="ArrowRight" ? 1 : -1)+items.length)%items.length;
    onChange(items[next][0]);event.currentTarget.parentElement.children[next].focus();
  }}>{title}</button>)}</div>;
}
function PolicySummary({ policy, effective, onEdit, editable=true, accessControl }) {
  const rows = [["Quyền truy cập",accessControl || (effective.enabled ? "Đang bật" : "Đã tắt"),false],
    ["Yêu cầu/ngày",quota(effective.daily),policy.daily==="inherit"], ["Yêu cầu/tuần",quota(effective.weekly),policy.weekly==="inherit"],
    ["Mô hình",effective.model,policy.model==="inherit"], ["Mức suy nghĩ",effortLabel[effective.effort],policy.model==="inherit"]];
  return <section aria-label="Cài đặt trợ lý"><div className={styles.sectionHead}><h2>Cài đặt{policy.model==="inherit" ? " của quản trị viên" : " trợ lý"}</h2>{editable && <button className={styles.secondary} onClick={onEdit}>Chỉnh sửa</button>}</div>
    <dl className={styles.settings}>{rows.map(([label,value,usesDefault]) => <div key={label}><dt>{label}</dt><dd>{value}{usesDefault && <small>Theo cài đặt chung</small>}</dd></div>)}</dl><Rules /></section>;
}
function PolicyEditor({ editor, defaults, onSaved, onClose }) {
  const [base,setBase]=useState(editor.policy),[draft,setDraft]=useState(editor.policy);
  const [saving,setSaving]=useState(false),[error,setError]=useState(null),[notice,setNotice]=useState("");
  const dirty=JSON.stringify(draft)!==JSON.stringify(base);
  const valid=[draft.daily,draft.weekly].every(v=>v===null || v==="inherit" || Number.isInteger(v) && v>0 && v<=2147483647);
  useEffect(()=>{ const warn=(event)=>{if(dirty){event.preventDefault();event.returnValue="";}};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn); },[dirty]);
  const close=()=>{if(!saving && (!dirty || window.confirm("Bỏ các thay đổi chưa lưu?"))) onClose();};
  const update=(key,value)=>setDraft(current=>({...current,[key]:value}));
  const save=async(event)=>{
    event.preventDefault();if(!dirty || !valid || saving) return;setSaving(true);setError(null);
    try { onSaved(await apiJson(`/api/admin/assistant/${editor.email ? `admins/${encodeURIComponent(editor.email)}` : "defaults"}`,{method:"PATCH",body:JSON.stringify(draft)})); }
    catch(e){setError(e);}finally{setSaving(false);}
  };
  const loadLatest=async()=>{
    if(dirty && !window.confirm("Thay bản nháp bằng cài đặt mới nhất?")) return;
    setSaving(true);try {const data=await apiJson("/api/admin/assistant");const latest=editor.email ? data.admins.find(p=>p.email===editor.email)?.policy : data.defaults;if(!latest) throw new Error("Quản trị viên không còn khả dụng.");setBase(latest);setDraft(latest);setError(null);setNotice("Đã mở cài đặt mới nhất.");}catch(e){setError(e);}finally{setSaving(false);}
  };
  return <Dialog.Root open onOpenChange={open=>{if(!open) close();}}><Dialog.Portal><Dialog.Overlay className={styles.overlay} /><Dialog.Content className={styles.editor} onCloseAutoFocus={e=>{e.preventDefault();editor.trigger?.focus();}} aria-describedby="policy-description">
    <header className={styles.editorHead}><Dialog.Title>{editor.email ? "Chỉnh sửa cài đặt" : "Chỉnh sửa cài đặt chung"}</Dialog.Title><Dialog.Description id="policy-description">{editor.email || "Áp dụng cho quản trị viên dùng cài đặt chung."}</Dialog.Description></header>
    <form onSubmit={save} className={styles.editorForm}><div className={styles.editorBody}>{editor.email && !defaults.enabled && <p className={styles.warning}>Quyền chung đang tắt. Cài đặt riêng vẫn được giữ.</p>}
    <><fieldset disabled={saving} className={styles.group}><legend>Hạn mức</legend>{[["daily","Yêu cầu/ngày"],["weekly","Yêu cầu/tuần"]].map(([key,label])=><div className={styles.field} key={key}><label htmlFor={`mode-${key}`}>{label}</label><div className={styles.quotaControl}><select id={`mode-${key}`} value={draft[key]==="inherit" ? "inherit" : draft[key]===null ? "unlimited" : "limited"} onChange={e=>update(key,e.target.value==="inherit" ? "inherit" : e.target.value==="unlimited" ? null : defaults[key] || (key==="daily" ? 50 : 250))}>{editor.email && <option value="inherit">Theo cài đặt chung</option>}<option value="limited">Giới hạn</option><option value="unlimited">Không giới hạn</option></select>{typeof draft[key]==="number" && <input aria-label={`Số ${label.toLowerCase()}`} type="number" min="1" max="2147483647" required value={Number.isNaN(draft[key]) ? "" : draft[key]} onChange={e=>update(key,e.target.valueAsNumber)} />}</div>{draft[key]==="inherit" && <small>{quota(defaults[key])}{defaults[key]!==null ? " yêu cầu" : ""}</small>}</div>)}</fieldset>
    <fieldset disabled={saving} className={styles.group}><legend>Mô hình và suy nghĩ</legend><label className={styles.field}>Mô hình<select value={draft.model} onChange={e=>{const model=e.target.value;const effort=model!=="inherit" && thinkingOptions(model).includes(draft.effort) ? draft.effort : "default";setDraft(current=>({...current,model,effort}));setNotice(effort!==draft.effort ? "Mức suy nghĩ đã chuyển về Tự động để phù hợp với mô hình." : "");}}>{editor.email && <option value="inherit">Theo cài đặt chung</option>}{ASSISTANT_MODELS.map(model=><option key={model}>{model}</option>)}</select></label>{draft.model==="inherit" ? <p className={styles.muted}>{defaults.model} · {effortLabel[defaults.effort]}</p> : <label className={styles.field}>Mức suy nghĩ<select aria-label="Mức suy nghĩ" aria-describedby="effort-help" value={draft.effort} onChange={e=>update("effort",e.target.value)}>{thinkingOptions(draft.model).map(effort=><option key={effort} value={effort}>{effortLabel[effort]}</option>)}</select><small id="effort-help">Để Gemini chọn mức suy nghĩ khi dùng Tự động.</small></label>}</fieldset>
    </>
    {notice && <p role="status" className={styles.success}>{notice}</p>}{error && <div role="alert" className={styles.warning}><p>{error.status===409 ? "Cài đặt đã được thay đổi ở nơi khác. Bản nháp của bạn vẫn được giữ." : error.message}</p>{error.status===409 && <button type="button" className={styles.secondary} disabled={saving} onClick={loadLatest}>Mở cài đặt mới nhất</button>}</div>}<Rules /></div>
    <footer className={styles.editorFooter}><button type="button" className={styles.secondary} disabled={saving} onClick={close}>Hủy</button><button className={styles.primary} disabled={saving || !dirty || !valid}>{saving ? "Đang lưu…" : "Lưu thay đổi"}</button></footer></form>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
function Skeleton(){return <div className={styles.skeleton} role="status" aria-label="Đang tải"><span/><span/><span/></div>;}

export default function AssistantManagementApp({ viewer,initial }) {
  const [data,setData]=useState(initial),[section,setSection]=useState("admins"),[email,setEmail]=useState(null),[detailTab,setDetailTab]=useState("settings");
  const [history,setHistory]=useState(null),[review,setReview]=useState(null),[editor,setEditor]=useState(null),[notice,setNotice]=useState("");
  const [loading,setLoading]=useState(false),[error,setError]=useState(null),[overviewError,setOverviewError]=useState(""),[stopping,setStopping]=useState(null);
  const generation=useRef(0),listScroll=useRef(0),heading=useRef(null);
  const admin=data.admins.find(person=>person.email===email);
  const accessWrites=useRef(0),refreshEpoch=useRef(0);
  const accessPending=(delta)=>{accessWrites.current+=delta;refreshEpoch.current++;};
  const mergeSaved=(result)=>setData(current=>({...result,defaults:current.defaults.version>result.defaults.version ? current.defaults : result.defaults,admins:result.admins.map(person=>{const old=current.admins.find(p=>p.email===person.email);return old && old.policy.version>person.policy.version ? old : person;})}));
  const refresh=useCallback(async()=>{if(accessWrites.current)return;const epoch=++refreshEpoch.current;try{const result=await apiJson("/api/admin/assistant");if(epoch===refreshEpoch.current){setData(result);setOverviewError("");}}catch(e){if(epoch===refreshEpoch.current)setOverviewError(e.message);}},[]);
  const accessControl=(person)=> <AccessSwitch policy={person ? person.policy : data.defaults} email={person?.email} globallyEnabled={data.defaults.enabled} onSaved={mergeSaved} onPending={accessPending} onRefresh={refresh} />;
  useEffect(()=>{const update=()=>{if(document.visibilityState==="visible") void refresh();};window.addEventListener("focus",update);const timer=setInterval(update,30000);return()=>{window.removeEventListener("focus",update);clearInterval(timer);};},[refresh]);
  const reviewId=review?.conversation.id;
  const running=review?.turns.some(turn=>turn.status==="running");
  useEffect(()=>{
    if(!reviewId || !running) return;
    let disposed=false,inFlight=false;
    const update=async()=>{if(document.visibilityState!=="visible" || inFlight) return;inFlight=true;try{const result=await apiJson(`/api/admin/assistant/conversations/${reviewId}`);if(!disposed){setReview(current=>{if(current?.conversation.id!==reviewId)return current;const turns=new Map(current.turns.map(turn=>[turn.id,turn]));result.turns.forEach(turn=>{const previous=turns.get(turn.id);if(!previous || previous.status==="running" || turn.status!=="running") turns.set(turn.id,turn);});return {...current,conversation:result.conversation,turns:[...turns.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))};});setError(null);}}catch(e){if(!disposed)setError({message:e.message,retry:update});}finally{inFlight=false;}};
    const timer=setInterval(update,3000);return()=>{disposed=true;clearInterval(timer);};
  },[reviewId,running]);
  const loadHistory=async(target,more=false)=>{
    const token=++generation.current;setLoading(true);setError(null);
    try{const result=await apiJson(`/api/admin/assistant/admins/${encodeURIComponent(target)}/conversations${query(more ? history?.cursor : null)}`);if(token===generation.current)setHistory(current=>({...result,items:more ? [...current.items,...result.items] : result.items}));}
    catch(e){if(token===generation.current)setError({message:e.message,retry:()=>loadHistory(target,more)});}finally{if(token===generation.current)setLoading(false);}
  };
  const openConversation=async(id,more=false)=>{
    const token=++generation.current;setLoading(true);setError(null);if(!more)setNotice("");
    try{const result=await apiJson(`/api/admin/assistant/conversations/${id}${query(more ? review?.cursor : null)}`);if(token===generation.current){setReview(current=>({...result,turns:more ? [...result.turns,...current.turns] : result.turns}));if(!more) requestAnimationFrame(()=>heading.current?.focus());}}
    catch(e){if(token===generation.current)setError({message:e.message,retry:()=>openConversation(id,more)});}finally{if(token===generation.current)setLoading(false);}
  };
  const selectAdmin=(person)=>{listScroll.current=window.scrollY;setEmail(person.email);setDetailTab(person.role==="admin" ? "settings" : "history");setHistory(null);setReview(null);setNotice("");void loadHistory(person.email);requestAnimationFrame(()=>heading.current?.focus());};
  const backToList=()=>{++generation.current;setEmail(null);setReview(null);setError(null);setLoading(false);requestAnimationFrame(()=>{window.scrollTo(0,listScroll.current);document.getElementById(`admin-${email}`)?.focus({preventScroll:true});});};
  const changeSection=(next)=>{++generation.current;setSection(next);setEmail(null);setReview(null);setLoading(false);setError(null);setNotice("");};
  const stop=async(turn)=>{setStopping(turn.id);try{await apiJson(`/api/admin/assistant/runs/${turn.id}/stop`,{method:"POST"});const result=await apiJson(`/api/admin/assistant/conversations/${reviewId}`);setReview(current=>current?.conversation.id===reviewId ? {...current,turns:current.turns.map(old=>result.turns.find(t=>t.id===old.id)||old)} : current);setNotice("Đã xử lý yêu cầu dừng.");}catch(e){setError({message:e.message,retry:()=>stop(turn)});}finally{setStopping(null);}};
  return <main className={shell["admin-shell"]}>
    <header className={styles.header}><Link href="/">Về lịch</Link><div><h1>Quản lý trợ lý</h1><span>{viewer.email}</span></div></header><AdminNav active="assistant" />
    <div className={styles.console}>
    <Tabs value={section} onChange={changeSection} label="Quản lý trợ lý" items={[["admins","Quản trị viên"],["defaults","Cài đặt chung"]]} />
    {!data.defaults.enabled && <p className={styles.warning}>Trợ lý đang tắt cho tất cả admin. Quyền chung ưu tiên hơn quyền riêng; các cài đặt riêng vẫn được giữ.</p>}
    {overviewError && <div role="alert" className={styles.warning}>{overviewError} <button className={styles.secondary} onClick={refresh}>Thử lại</button></div>}
    {notice && <p role="status" className={styles.success}>{notice}</p>}
    {error && <div role="alert" className={styles.warning}>{error.message} <button className={styles.secondary} onClick={error.retry}>Thử lại</button></div>}
    <div className={styles.content}>
    {section==="defaults" ? <PolicySummary accessControl={accessControl()} policy={data.defaults} effective={data.defaults} onEdit={event=>setEditor({policy:data.defaults,trigger:event.currentTarget})} /> : review ? <section aria-label="Xem lại cuộc trò chuyện">
      <button className={styles.back} onClick={()=>{++generation.current;setReview(null);setDetailTab("history");setError(null);setLoading(false);requestAnimationFrame(()=>heading.current?.focus());}}>Về cuộc trò chuyện</button>
      <div className={styles.sectionHead}><div><h2 ref={heading} tabIndex={-1}>{review.conversation.title}</h2><p className={styles.muted}>{review.email} · Chỉ xem</p></div></div>
      {review.cursor && <button className={styles.secondary} disabled={loading} onClick={()=>openConversation(reviewId,true)}>{loading ? "Đang tải…" : "Xem yêu cầu trước"}</button>}
      <details className={styles.rules}><summary>Ngữ cảnh cuộc trò chuyện</summary><ReferenceList label="Ngữ cảnh đã ghim" items={review.conversation.pins.map(ref=>({ref}))} /></details><div className={styles.review}>{review.turns.map(turn=><article className={styles.turn} key={turn.id}><header><span>{date(turn.createdAt)} JST</span><Badge enabled={turn.status==="completed"}>{status(turn)}</Badge>{["running","awaiting_approval"].includes(turn.status) && <button className={styles.danger} disabled={stopping===turn.id} onClick={()=>stop(turn)}>{stopping===turn.id ? "Đang dừng…" : "Dừng yêu cầu"}</button>}</header>
        <div className={styles.question}><h3>Quản trị viên</h3><p>{turn.input}</p></div><div className={styles.answer}><h3>Trợ lý</h3><MessageContent text={turn.output || (turn.status==="running" ? "Đang chuẩn bị câu trả lời…" : "Chưa có câu trả lời.")} citations={turn.citations} onCitation={id=>{const target=document.getElementById(`${turn.id}-evidence-${id}`);target?.scrollIntoView({block:"center"});target?.focus({preventScroll:true});}} />{!!turn.citations.length && <EvidencePanel citations={turn.citations} idPrefix={`${turn.id}-evidence`} />}{turn.actions?.map(action=><BatchReview key={action.id} action={action} readOnly />)}{turn.changeSet && <ChangePanel changeSet={turn.changeSet} readOnly />}</div>
        <details className={styles.rules}><summary>Chi tiết yêu cầu</summary><p>{turn.executionSettings ? `${turn.executionSettings.model} · ${effortLabel[turn.executionSettings.effort]}` : "Chưa có dữ liệu mô hình và mức suy nghĩ."}{turn.retryOfTurnId && " · Lần thử lại"}</p><ReferenceList label="Ngữ cảnh tin nhắn" items={turn.resolvedContext} /><ReferenceList label="Ngữ cảnh đã dùng" items={turn.usedContext} /></details>
      </article>)}</div></section> : admin ? <section aria-label="Chi tiết admin"><button className={styles.back} onClick={backToList}>Về danh sách quản trị viên</button><div className={styles.sectionHead}><div><h2 ref={heading} tabIndex={-1}>{admin.name}</h2><p className={styles.muted}>{admin.email}</p></div><Badge enabled={admin.access.enabled}>{admin.role!=="admin" ? "Cựu admin" : admin.access.enabled ? "Đang bật" : "Đã tắt"}</Badge></div>
      <Tabs value={detailTab} onChange={setDetailTab} label="Chi tiết quản trị viên" items={[["settings","Cài đặt"],["history","Cuộc trò chuyện"]]} />
      {detailTab==="settings" ? <><div className={styles.usageSummary}><div><span>Hôm nay</span><Usage used={admin.access.dailyUsed} limit={admin.access.daily} /><small>Đặt lại {date(admin.access.dailyReset)} JST</small></div><div><span>Tuần này</span><Usage used={admin.access.weeklyUsed} limit={admin.access.weekly} /><small>Đặt lại {date(admin.access.weeklyReset)} JST</small></div></div><PolicySummary accessControl={admin.role==="admin" ? accessControl(admin) : null} policy={admin.policy} effective={admin.access} editable={admin.role==="admin"} onEdit={event=>setEditor({email:admin.email,policy:admin.policy,trigger:event.currentTarget})} /></> : <>{loading && !history ? <Skeleton /> : history?.items.length===0 ? <p className={styles.empty}>Chưa có cuộc trò chuyện của quản trị viên này.</p> : <table className={styles.history}><thead><tr><th>Cuộc trò chuyện</th><th>Cập nhật gần nhất</th><th>Trạng thái</th></tr></thead><tbody>{history?.items.map(conversation=><tr key={conversation.id}><td><button className={styles.link} disabled={loading} onClick={()=>openConversation(conversation.id)}>{conversation.title}</button></td><td>{date(conversation.updatedAt)} JST</td><td>{conversation.status==="failed" ? "Đã kết thúc" : status(conversation)}</td></tr>)}</tbody></table>}{history?.cursor && <button className={styles.secondary} disabled={loading} onClick={()=>loadHistory(email,true)}>{loading ? "Đang tải…" : "Xem thêm cuộc trò chuyện"}</button>}</>}
    </section> : <section aria-label="Danh sách admin">{!data.admins.length ? <div className={styles.empty}><h2>Chưa có quản trị viên khác</h2><p>Khi có quản trị viên, quyền truy cập và mức sử dụng của họ sẽ xuất hiện tại đây.</p><Link href="/admin/users">Quản lý người dùng</Link></div> : <table className={styles.admins}><thead><tr>{["Quản trị viên","Trạng thái","Hôm nay","Tuần này","Mô hình","Cài đặt"].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{data.admins.map(person=><tr key={person.email}><td><button id={`admin-${person.email}`} className={styles.link} onClick={()=>selectAdmin(person)}>{person.name}<small>{person.email}</small></button></td><td>{person.role==="admin" ? accessControl(person) : <Badge>Cựu admin</Badge>}</td><td data-label="Hôm nay"><Usage used={person.access.dailyUsed} limit={person.access.daily} /></td><td data-label="Tuần này"><Usage used={person.access.weeklyUsed} limit={person.access.weekly} /></td><td className={styles.secondaryColumn}>{person.access.model}<small>{effortLabel[person.access.effort]}</small></td><td className={styles.secondaryColumn}>{inherited(person.policy) ? "Theo cài đặt chung" : "Cài đặt riêng"}</td></tr>)}</tbody></table>}</section>}
    </div></div>{editor && <PolicyEditor editor={editor} defaults={data.defaults} onClose={()=>setEditor(null)} onSaved={result=>{setData(result);setEditor(null);setNotice("Đã lưu thay đổi. Áp dụng từ yêu cầu tiếp theo.");}} />}
  </main>;
}
