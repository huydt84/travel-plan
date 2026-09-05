"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import AdminNav from "./AdminNav";
import TripRequestDetails, { formatRequestRange, requestStateLabels } from "./TripRequestDetails";

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "content-type": "application/json" } : options.headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Không thể cập nhật yêu cầu");
  return payload;
};

export default function TripRequestAdminApp({ viewer, initialRequests, trips, pendingInvitationCount = 0 }) {
  const router = useRouter();
  const [requests, setRequests] = useState(initialRequests);
  const [selectedId, setSelectedId] = useState(initialRequests.find((request) => request.state === "open")?.id || initialRequests[0]?.id || null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("open");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [declineReason, setDeclineReason] = useState(null);
  const [creatingTrip, setCreatingTrip] = useState(false);
  const [tripDraft, setTripDraft] = useState(null);
  const [attachSlug, setAttachSlug] = useState(trips[0]?.slug || "");

  const openCount = requests.filter((request) => request.state === "open").length;
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => requests.filter((request) => (
    (filter === "all" || request.state === filter)
    && (!needle || request.requester.name.toLowerCase().includes(needle)
      || request.requester.email.toLowerCase().includes(needle)
      || request.places.some((place) => place.toLowerCase().includes(needle)))
  )), [filter, needle, requests]);
  const selected = requests.find((request) => request.id === selectedId) || visible[0] || requests[0] || null;

  const replaceRequest = (updated) => {
    setRequests((current) => current.map((request) => request.id === updated.id ? updated : request));
    setSelectedId(updated.id);
  };
  const run = async (action, success) => {
    setBusy(true); setError(""); setNotice("");
    try { const result = await action(); if (result?.id) replaceRequest(result); setNotice(success); return result; }
    catch (actionError) { setError(`${actionError.message}. Hãy thử lại.`); return null; }
    finally { setBusy(false); }
  };
  const selectRequest = (request) => {
    if (creatingTrip && !window.confirm("Bỏ bản nháp trip chưa lưu?")) return;
    setSelectedId(request.id); setCreatingTrip(false); setTripDraft(null); setDeclineReason(null); setError("");
  };
  const startTrip = () => {
    setCreatingTrip(true);
    setDeclineReason(null);
    setTripDraft({ slug: "", title: "", startDate: selected.startDate, endDate: selected.endDate, timezone: "Asia/Tokyo", location: selected.places.join(", ") });
  };
  const createTrip = async (event) => {
    event.preventDefault();
    const created = await run(
      () => api(`/api/admin/trip-requests/${selected.id}/trip`, { method: "POST", body: JSON.stringify(tripDraft) }),
      "Đã tạo và gắn lịch trình với yêu cầu.",
    );
    if (created?.slug) router.push(`/admin/trips?trip=${encodeURIComponent(created.slug)}`);
  };

  return (
    <main className="admin-shell request-admin-shell">
      <header className="admin-header">
        <div><Link href="/" className="admin-back">Về lịch</Link><h1>Yêu cầu chuyến đi</h1><small className="admin-user">{viewer.email}</small></div>
        {viewer.authMode !== "local-dev" && <button className="admin-ghost" type="button" onClick={() => signOut({ redirectTo: "/" })}>Đăng xuất</button>}
      </header>
      <AdminNav active="requests" pendingInvitationCount={pendingInvitationCount} pendingTripRequestCount={openCount} />
      {error && <p className="admin-alert" role="alert">{error}</p>}
      {notice && <p className="admin-notice" role="status">{notice}</p>}

      <section className="request-admin-board">
        <div className="request-admin-controls">
          <label>Tìm người hoặc địa điểm<input type="search" value={query} placeholder="Tên, email, địa điểm…" onChange={(event) => setQuery(event.target.value)} /></label>
          <label>Trạng thái<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="open">Đang chờ</option><option value="fulfilled">Đã có lịch</option><option value="declined">Không thực hiện</option><option value="withdrawn">Đã rút</option><option value="all">Tất cả</option></select></label>
          <p><strong>{openCount}</strong> yêu cầu đang chờ · hiện {visible.length}/{requests.length}</p>
        </div>

        <div className="request-admin-workspace">
          <aside className="request-admin-queue" aria-label="Danh sách yêu cầu">
            {visible.map((request) => (
              <button className={`request-admin-row is-${request.state}${selected?.id === request.id ? " is-active" : ""}`} type="button" onClick={() => selectRequest(request)} key={request.id}>
                <span className="request-rail-node" aria-hidden="true" /><b>{request.places.join(" · ")}</b><small>{request.requester.name} · {formatRequestRange(request)}</small><em>{requestStateLabels[request.state]}</em>
              </button>
            ))}
            {!visible.length && <p className="request-admin-empty">Không có yêu cầu khớp bộ lọc này.</p>}
          </aside>

          <div className="request-admin-stage">
            {selected ? <article className={`request-admin-ticket is-${selected.state}`}>
              <header className="request-admin-ticket-head">
                <div><span>{requestStateLabels[selected.state]}</span><h2>{selected.places.join(" · ")}</h2><p>{selected.requester.name} · {selected.requester.email}</p></div>
                <div className="request-admin-actions">
                  {selected.state === "open" && <><button className="admin-primary" type="button" disabled={busy} onClick={startTrip}>Tạo lịch mới</button><button className="admin-danger" type="button" disabled={busy} onClick={() => { setDeclineReason(""); setCreatingTrip(false); }}>Không thực hiện</button></>}
                  {selected.state === "declined" && <button className="admin-primary" type="button" disabled={busy} onClick={() => run(() => api(`/api/admin/trip-requests/${selected.id}`, { method: "PATCH", body: JSON.stringify({ action: "restore" }) }), "Đã đưa yêu cầu trở lại hàng chờ.")}>Khôi phục</button>}
                  {selected.state === "fulfilled" && <button className="admin-danger" type="button" disabled={busy} onClick={() => { if (window.confirm("Gỡ lịch trình khỏi yêu cầu này?")) run(() => api(`/api/admin/trip-requests/${selected.id}/fulfillment`, { method: "DELETE" }), "Đã gỡ lịch; yêu cầu trở lại hàng chờ."); }}>Gỡ lịch</button>}
                </div>
              </header>

              {selected.state === "open" && !creatingTrip && (
                <form className="request-attach-strip" onSubmit={(event) => { event.preventDefault(); run(() => api(`/api/admin/trip-requests/${selected.id}/fulfillment`, { method: "PUT", body: JSON.stringify({ tripSlug: attachSlug }) }), "Đã gắn lịch có sẵn và gửi thông báo trong ứng dụng."); }}>
                  <label>Gắn lịch có sẵn<select value={attachSlug} onChange={(event) => setAttachSlug(event.target.value)} disabled={!trips.length}>{trips.map((trip) => <option value={trip.slug} key={trip.slug}>{trip.title} · {trip.startDate}</option>)}</select></label>
                  <button className="admin-ghost" disabled={busy || !trips.length}>{busy ? "Đang gắn…" : "Gắn lịch"}</button>
                </form>
              )}

              {declineReason !== null && selected.state === "open" && (
                <form className="request-decline-form" onSubmit={(event) => { event.preventDefault(); run(() => api(`/api/admin/trip-requests/${selected.id}`, { method: "PATCH", body: JSON.stringify({ action: "decline", reason: declineReason }) }), "Đã cập nhật trạng thái yêu cầu.").then((result) => { if (result) setDeclineReason(null); }); }}>
                  <label>Lý do không thực hiện<textarea rows={3} maxLength={300} value={declineReason} placeholder="Không bắt buộc" onChange={(event) => setDeclineReason(event.target.value)} /><span>{declineReason.length}/300</span></label>
                  <div><button className="admin-ghost" type="button" onClick={() => setDeclineReason(null)}>Huỷ</button><button className="admin-danger" disabled={busy}>{busy ? "Đang cập nhật…" : "Xác nhận không thực hiện"}</button></div>
                </form>
              )}

              {creatingTrip && tripDraft && selected.state === "open" && (
                <form className="request-trip-editor" onSubmit={createTrip}>
                  <div className="admin-section-head"><div><h3>Tạo trip từ yêu cầu</h3><p>Ngày và địa điểm đã được điền từ yêu cầu; tên, slug và timezone vẫn do admin quyết định.</p></div><button className="admin-ghost" type="button" onClick={() => { setCreatingTrip(false); setTripDraft(null); }}>Đóng</button></div>
                  <div className="form-grid"><label>Slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={tripDraft.slug} placeholder="kamakura-2026-10-10" onChange={(event) => setTripDraft({ ...tripDraft, slug: event.target.value })} /></label><label>Tên trip<input required maxLength={160} value={tripDraft.title} onChange={(event) => setTripDraft({ ...tripDraft, title: event.target.value })} /></label><label>Ngày bắt đầu<input required type="date" value={tripDraft.startDate} onChange={(event) => setTripDraft({ ...tripDraft, startDate: event.target.value })} /></label><label>Ngày kết thúc<input required type="date" min={tripDraft.startDate} value={tripDraft.endDate} onChange={(event) => setTripDraft({ ...tripDraft, endDate: event.target.value })} /></label><label>Timezone<input required value={tripDraft.timezone} onChange={(event) => setTripDraft({ ...tripDraft, timezone: event.target.value })} /></label><label className="wide">Địa điểm<input required maxLength={160} value={tripDraft.location} onChange={(event) => setTripDraft({ ...tripDraft, location: event.target.value })} /></label></div>
                  <footer><button className="admin-ghost" type="button" onClick={() => { setCreatingTrip(false); setTripDraft(null); }}>Huỷ</button><button className="admin-primary" disabled={busy}>{busy ? "Đang tạo…" : "Tạo và gắn lịch"}</button></footer>
                </form>
              )}

              <TripRequestDetails request={selected} admin />
            </article> : <div className="request-stage-empty"><h2>Chưa có yêu cầu</h2><p>Yêu cầu mới sẽ xuất hiện tại hàng chờ này.</p></div>}
          </div>
        </div>
      </section>
    </main>
  );
}
