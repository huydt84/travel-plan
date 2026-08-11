"use client";

import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { createInvitationDraft, formatInvitationTripDate } from "../lib/invitation-draft.mjs";
import AdminNav from "./AdminNav";

const loginTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Tokyo",
});

function LoginTime({ value }) {
  return (
    <time dateTime={value}>
      <span>{loginTimeFormatter.format(new Date(value))}</span>
      <small>JST</small>
    </time>
  );
}

export default function UserManagementApp({ viewer, users, trips, initialTripSlug }) {
  const [tripSlug, setTripSlug] = useState(initialTripSlug);
  const [loadedPlan, setLoadedPlan] = useState(null);
  const [draft, setDraft] = useState({ subject: "", message: "" });
  const [draftLoading, setDraftLoading] = useState(Boolean(initialTripSlug));
  const [draftError, setDraftError] = useState("");
  const [draftTouched, setDraftTouched] = useState(false);
  const [draftEmail, setDraftEmail] = useState("");
  const [recipients, setRecipients] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const requestIdRef = useRef(null);
  const emailInputRef = useRef(null);
  const knownEmails = users.map((user) => user.email);
  const selectedTrip = trips.find((trip) => trip.slug === tripSlug) || null;
  const typedRecipient = draftEmail.trim().toLowerCase();
  const pendingRecipientCount = recipients.length + (typedRecipient && !recipients.includes(typedRecipient) ? 1 : 0);

  const draftForPlan = (plan) => createInvitationDraft({
    trip: plan.trip,
    itinerary: plan.schedule,
    inviter: viewer,
    url: `${window.location.origin}/?trip=${encodeURIComponent(plan.trip.slug)}`,
  });

  useEffect(() => {
    if (!tripSlug) {
      setLoadedPlan(null);
      setDraft({ subject: "", message: "" });
      setDraftLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setDraftLoading(true);
    setDraftError("");
    setDraftTouched(false);
    fetch(`/api/trips/${encodeURIComponent(tripSlug)}/schedule`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Không thể tải lịch trình")))
      .then((plan) => {
        setLoadedPlan(plan);
        setDraft(draftForPlan(plan));
      })
      .catch((loadError) => {
        if (loadError.name === "AbortError") return;
        setLoadedPlan(null);
        setDraft({ subject: "", message: "" });
        setDraftError("Không thể tạo bản nháp từ lịch trình này. Hãy thử chọn lại chuyến đi.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDraftLoading(false);
      });
    return () => controller.abort();
  }, [tripSlug]);

  const updateRecipients = (nextRecipients) => {
    const uniqueRecipients = [...new Set(nextRecipients)];
    if (uniqueRecipients.length > 100) {
      setError("Chỉ có thể gửi tối đa 100 lời mời mỗi lần.");
      return false;
    }
    requestIdRef.current = null;
    setRecipients(uniqueRecipients);
    setError("");
    setNotice("");
    return true;
  };

  const addDraftEmail = () => {
    const email = draftEmail.trim().toLowerCase();
    if (!email) {
      setError("Nhập địa chỉ email muốn mời.");
      emailInputRef.current?.focus();
      return;
    }
    if (!emailInputRef.current?.checkValidity()) {
      emailInputRef.current?.reportValidity();
      return;
    }
    if (recipients.includes(email)) {
      setError("Email này đã có trong danh sách gửi.");
      return;
    }
    if (updateRecipients([...recipients, email])) {
      setDraftEmail("");
      emailInputRef.current?.focus();
    }
  };

  const toggleRecipient = (email) => {
    updateRecipients(recipients.includes(email)
      ? recipients.filter((recipient) => recipient !== email)
      : [...recipients, email]);
  };

  const allKnownSelected = knownEmails.length > 0 && knownEmails.every((email) => recipients.includes(email));

  const toggleAllKnown = () => {
    if (allKnownSelected) {
      updateRecipients(recipients.filter((email) => !knownEmails.includes(email)));
    } else {
      updateRecipients([...recipients, ...knownEmails]);
    }
  };

  const sendInvitations = async (event) => {
    event.preventDefault();
    const typedEmail = draftEmail.trim().toLowerCase();
    if (typedEmail && !emailInputRef.current?.checkValidity()) {
      emailInputRef.current?.reportValidity();
      return;
    }
    const sendingTo = [...new Set([...recipients, ...(typedEmail ? [typedEmail] : [])])];
    if (!sendingTo.length) {
      setError("Nhập email hoặc chọn ít nhất một người dùng.");
      emailInputRef.current?.focus();
      return;
    }
    if (sendingTo.length > 100) {
      setError("Chỉ có thể gửi tối đa 100 lời mời mỗi lần.");
      return;
    }
    if (!loadedPlan || loadedPlan.trip.slug !== tripSlug) {
      setError("Bản nháp chưa sẵn sàng. Hãy chờ lịch trình tải xong.");
      return;
    }
    if (!draft.subject.trim() || !draft.message.trim()) {
      setError("Tiêu đề và nội dung email không được để trống.");
      return;
    }

    requestIdRef.current ||= crypto.randomUUID();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: sendingTo,
          requestId: requestIdRef.current,
          tripSlug,
          subject: draft.subject,
          message: draft.message,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Không thể gửi lời mời lúc này.");
      setRecipients([]);
      setDraftEmail("");
      requestIdRef.current = null;
      setNotice(`Đã gửi ${payload.sent} lời rủ đi “${selectedTrip.title}”.`);
    } catch (sendError) {
      setError(sendError.message || "Không thể gửi lời mời lúc này. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-shell admin-users-shell">
      <header className="admin-header">
        <div>
          <a href="/" className="admin-back">Về lịch</a>
          <h1>Người dùng</h1>
          <small className="admin-user">{viewer.email}</small>
        </div>
        <button className="admin-ghost" onClick={() => signOut({ redirectTo: "/" })}>Đăng xuất</button>
      </header>

      <AdminNav active="users" />

      <section className="admin-invitations" aria-labelledby="admin-invitations-title">
        <div className="admin-invitations-head">
          <div>
            <h2 id="admin-invitations-title">Rủ đi cùng</h2>
            <p>Gửi một lời rủ cá nhân với địa điểm, ngày giờ và toàn bộ lịch trình của chuyến đi.</p>
          </div>
          <strong aria-live="polite">{recipients.length} người đã chọn</strong>
        </div>

        <form className="invitation-form" onSubmit={sendInvitations} noValidate>
          {error && <div className="admin-alert invitation-message" role="alert"><span>{error}</span></div>}
          {notice && <div className="admin-notice invitation-message" role="status"><span>{notice}</span></div>}

          <div className="invitation-trip-picker">
            <label htmlFor="invitation-trip">Chuyến đi muốn rủ</label>
            {trips.length ? (
              <>
                <select
                  id="invitation-trip"
                  value={tripSlug}
                  onChange={(event) => {
                    const nextTripSlug = event.target.value;
                    if (draftTouched && !window.confirm("Đổi chuyến đi sẽ thay thế bản nháp bạn đã chỉnh sửa. Tiếp tục?")) return;
                    setTripSlug(nextTripSlug);
                    setLoadedPlan(null);
                    setDraftLoading(true);
                    requestIdRef.current = null;
                    setError("");
                    setNotice("");
                  }}
                  disabled={busy}
                >
                  {trips.map((trip) => (
                    <option key={trip.slug} value={trip.slug}>
                      {trip.title} · {trip.date} · {trip.location}
                    </option>
                  ))}
                </select>
                <div className="invitation-trip-preview" aria-live="polite">
                  <strong>{selectedTrip.title}</strong>
                  <span>{formatInvitationTripDate(selectedTrip)} · {selectedTrip.location} · {selectedTrip.scheduleCount} mục</span>
                  <p>“Bạn có muốn đi {selectedTrip.location} cùng mình không?”</p>
                </div>
              </>
            ) : (
              <p className="invitation-trip-empty">Hãy tạo một chuyến đi và lịch trình trước khi gửi lời rủ.</p>
            )}
          </div>

          <div className="invitation-compose">
            <h3>Nhập email</h3>
            <label htmlFor="invitation-email">Địa chỉ người nhận</label>
            <div className="invitation-email-row">
              <input
                ref={emailInputRef}
                id="invitation-email"
                type="email"
                autoComplete="email"
                placeholder="banbe@example.com"
                value={draftEmail}
                onChange={(event) => {
                  setDraftEmail(event.target.value);
                  requestIdRef.current = null;
                  setError("");
                  setNotice("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addDraftEmail();
                  }
                }}
                disabled={busy}
              />
              <button className="admin-ghost" type="button" onClick={addDraftEmail} disabled={busy}>Thêm email</button>
            </div>
            <p>Nhấn Enter hoặc “Thêm email” để tạo danh sách nhiều người nhận.</p>

            <div className="invitation-manifest" aria-live="polite">
              <div className="invitation-manifest-head">
                <h4>Danh sách gửi</h4>
                <span>{recipients.length ? `${recipients.length}/100` : "Chưa có email"}</span>
              </div>
              {recipients.length ? (
                <ul>
                  {recipients.map((email) => (
                    <li key={email}>
                      <span>{email}</span>
                      <button type="button" onClick={() => toggleRecipient(email)} disabled={busy} aria-label={`Bỏ ${email} khỏi danh sách`}>Bỏ</button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Email bạn nhập hoặc chọn sẽ xuất hiện ở đây.</p>
              )}
            </div>
          </div>

          <fieldset className="invitation-directory" disabled={busy}>
            <legend>Chọn từ người dùng</legend>
            <div className="invitation-directory-head">
              <p>{users.length ? `${users.length} tài khoản đã từng đăng nhập` : "Chưa có tài khoản đã đăng nhập"}</p>
              {users.length > 0 && (
                <button className="admin-ghost" type="button" onClick={toggleAllKnown}>
                  {allKnownSelected ? "Bỏ tất cả" : "Chọn tất cả"}
                </button>
              )}
            </div>
            {users.length ? (
              <div className="invitation-directory-list">
                {users.map((loginUser) => (
                  <label key={loginUser.email} className="invitation-user-option">
                    <input
                      type="checkbox"
                      checked={recipients.includes(loginUser.email)}
                      onChange={() => toggleRecipient(loginUser.email)}
                    />
                    <span>
                      <strong>{loginUser.name}</strong>
                      <small>{loginUser.email}</small>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="invitation-directory-empty">Người dùng sẽ xuất hiện sau lần đăng nhập Google đầu tiên.</p>
            )}
          </fieldset>

          <section className="invitation-draft" aria-labelledby="invitation-draft-title">
            <div className="invitation-draft-head">
              <div>
                <h3 id="invitation-draft-title">Bản nháp email</h3>
                <p>Nội dung được tạo từ chuyến đi đã chọn. Bạn có thể sửa trực tiếp trước khi gửi.</p>
              </div>
              <div>
                <span>{draftTouched ? "Đã chỉnh sửa thủ công" : "Đồng bộ từ lịch trình"}</span>
                <button
                  className="admin-ghost"
                  type="button"
                  onClick={() => {
                    if (!loadedPlan) return;
                    if (draftTouched && !window.confirm("Tạo lại từ lịch trình sẽ thay thế nội dung bạn đã chỉnh sửa. Tiếp tục?")) return;
                    setDraft(draftForPlan(loadedPlan));
                    setDraftTouched(false);
                    requestIdRef.current = null;
                    setError("");
                    setNotice("");
                  }}
                  disabled={busy || draftLoading || !loadedPlan}
                >
                  Tạo lại từ lịch trình
                </button>
              </div>
            </div>
            {draftError && <p className="invitation-draft-error" role="alert">{draftError}</p>}
            <label htmlFor="invitation-subject">Tiêu đề email</label>
            <input
              id="invitation-subject"
              value={draft.subject}
              maxLength={200}
              required
              disabled={busy || draftLoading}
              placeholder={draftLoading ? "Đang tạo tiêu đề…" : "Nhập tiêu đề email"}
              onChange={(event) => {
                setDraft((current) => ({ ...current, subject: event.target.value }));
                setDraftTouched(true);
                requestIdRef.current = null;
                setError("");
                setNotice("");
              }}
            />
            <div className="invitation-draft-label-row">
              <label htmlFor="invitation-message">Nội dung email</label>
              <span>{draft.message.length}/10000</span>
            </div>
            <textarea
              id="invitation-message"
              value={draft.message}
              maxLength={10000}
              rows={15}
              required
              disabled={busy || draftLoading}
              placeholder={draftLoading ? "Đang tạo nội dung từ lịch trình…" : "Nhập nội dung email"}
              onChange={(event) => {
                setDraft((current) => ({ ...current, message: event.target.value }));
                setDraftTouched(true);
                requestIdRef.current = null;
                setError("");
                setNotice("");
              }}
            />
          </section>

          <div className="invitation-dispatch">
            <p>
              <strong>{pendingRecipientCount} lời rủ</strong>
              <span>Mỗi người nhận một email riêng với lịch trình đầy đủ.</span>
            </p>
            <button className="admin-primary" type="submit" disabled={busy || draftLoading || pendingRecipientCount === 0 || !loadedPlan}>
              {busy ? "Đang gửi…" : "Gửi lời rủ đi cùng"}
            </button>
          </div>
        </form>
      </section>

      <section className="admin-users" aria-labelledby="admin-users-title">
        <div className="admin-users-head">
          <div>
            <h2 id="admin-users-title">Lịch sử đăng nhập</h2>
            <p>{users.length} tài khoản Google · chỉ giữ lần đầu và lần đăng nhập gần nhất.</p>
          </div>
        </div>
        {users.length ? (
          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th scope="col">Tên</th>
                  <th scope="col">Email</th>
                  <th scope="col">Lần đầu đăng nhập</th>
                  <th scope="col">Gần nhất</th>
                </tr>
              </thead>
              <tbody>
                {users.map((loginUser) => (
                  <tr key={loginUser.email}>
                    <td data-label="Tên"><strong>{loginUser.name}</strong></td>
                    <td data-label="Email">{loginUser.email}</td>
                    <td data-label="Lần đầu đăng nhập"><LoginTime value={loginUser.first_login} /></td>
                    <td data-label="Gần nhất"><LoginTime value={loginUser.last_login} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-users-empty">Chưa có dữ liệu. Tài khoản sẽ xuất hiện sau lần đăng nhập Google tiếp theo.</p>
        )}
      </section>
    </main>
  );
}
