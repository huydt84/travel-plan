"use client";
import adminShellStyles from "../src/styles/admin-shell.module.css";
import scheduleEditorStyles from "../src/styles/schedule-editor.module.css";
import tripRequestsStyles from "../src/styles/trip-requests.module.css";

import Footer from "./ui/Footer";
import Button from "./ui/Button";

import { requestJson } from "../lib/request-json.mjs";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import NotificationCenter from "./NotificationCenter";
import TripRequestDetails, {
  formatRequestRange,
  requestStateLabels,
} from "./TripRequestDetails";
import ViewerMenu from "./ViewerMenu";

const emptyRequest = {
  startDate: "",
  endDate: "",
  places: [""],
  sources: [],
  notes: "",
};

const api = (path, options) =>
  requestJson(path, options, "Không thể cập nhật yêu cầu");

export default function TripRequestApp({ viewer, initialRequests }) {
  if (!viewer) return <RequestLogin />;
  return <RequestWorkspace viewer={viewer} initialRequests={initialRequests} />;
}

function RequestLogin() {
  return (
    <main
      className={`${adminShellStyles["admin-shell"]} ${scheduleEditorStyles["admin-login-shell"]} request-login-shell`}
    >
      <section className={scheduleEditorStyles["admin-login-card"]}>
        <Link href="/" className={adminShellStyles["admin-back"]}>
          Về lịch trình
        </Link>
        <h1>Yêu cầu chuyến đi</h1>
        <p>
          Đăng nhập bằng Google để gửi yêu cầu và theo dõi lịch trình được tạo
          cho bạn.
        </p>
        <Button
          variant="primary"
          type="button"
          onClick={() => signIn("google", { redirectTo: "/requests" })}
        >
          Đăng nhập để tiếp tục
        </Button>
      </section>
    </main>
  );
}

function RequestWorkspace({ viewer, initialRequests }) {
  const [requests, setRequests] = useState(initialRequests);
  const [selectedId, setSelectedId] = useState(initialRequests[0]?.id || null);
  const [editor, setEditor] = useState(
    initialRequests.length
      ? null
      : { mode: "new", initial: emptyRequest, values: emptyRequest },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected =
    requests.find((request) => request.id === selectedId) ||
    requests[0] ||
    null;
  const editorDirty =
    editor && JSON.stringify(editor.initial) !== JSON.stringify(editor.values);

  useEffect(() => {
    if (!editorDirty) return undefined;
    const protectDraft = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [editorDirty]);

  const leaveEditor = () =>
    !editorDirty ||
    window.confirm("Bỏ các thay đổi chưa lưu trong yêu cầu này?");
  const chooseRequest = (request) => {
    if (!leaveEditor()) return;
    setSelectedId(request.id);
    setEditor(null);
    setError("");
  };
  const startNew = () => {
    if (!leaveEditor()) return;
    const values = { ...emptyRequest, places: [""], sources: [] };
    setEditor({ mode: "new", initial: values, values });
    setSelectedId(null);
    setError("");
  };
  const startEdit = () => {
    if (!selected || selected.state !== "open") return;
    const values = {
      startDate: selected.startDate,
      endDate: selected.endDate,
      places: [...selected.places],
      sources: selected.sources.map((source) => ({ ...source })),
      notes: selected.notes,
    };
    setEditor({
      mode: "edit",
      requestId: selected.id,
      initial: values,
      values,
    });
  };
  const replaceRequest = (updated) => {
    setRequests((current) =>
      current.some((item) => item.id === updated.id)
        ? current.map((item) => (item.id === updated.id ? updated : item))
        : [updated, ...current],
    );
    setSelectedId(updated.id);
  };

  const saveRequest = async (values) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated =
        editor.mode === "new"
          ? await api("/api/trip-requests", {
              method: "POST",
              body: JSON.stringify(values),
            })
          : await api(`/api/trip-requests/${editor.requestId}`, {
              method: "PATCH",
              body: JSON.stringify({ action: "update", request: values }),
            });
      replaceRequest(updated);
      setEditor(null);
      setNotice(
        editor.mode === "new"
          ? "Đã gửi yêu cầu chuyến đi."
          : "Đã lưu thay đổi trong yêu cầu.",
      );
    } catch (saveError) {
      setError(`${saveError.message}. Hãy kiểm tra lại các trường.`);
    } finally {
      setBusy(false);
    }
  };

  const changeState = async (request, action) => {
    const question =
      action === "withdraw"
        ? "Rút yêu cầu chuyến đi này? Bạn có thể khôi phục sau."
        : null;
    if (question && !window.confirm(question)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await api(`/api/trip-requests/${request.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      replaceRequest(updated);
      setNotice(
        action === "withdraw"
          ? "Đã rút yêu cầu."
          : "Đã khôi phục yêu cầu vào hàng chờ.",
      );
    } catch (stateError) {
      setError(`${stateError.message}. Hãy thử lại.`);
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(
    () => ({
      open: requests.filter((request) => request.state === "open").length,
      fulfilled: requests.filter((request) => request.state === "fulfilled")
        .length,
    }),
    [requests],
  );

  return (
    <main className={tripRequestsStyles["request-shell"]}>
      <header className={tripRequestsStyles["request-header"]}>
        <div>
          <Link href="/" className={adminShellStyles["admin-back"]}>
            Về lịch trình
          </Link>
          <h1>Yêu cầu chuyến đi</h1>
          <p>
            Gửi nơi bạn muốn đến. Lịch trình hoàn chỉnh sẽ quay lại đúng tài
            khoản này.
          </p>
        </div>
        <div className={tripRequestsStyles["request-header-tools"]}>
          <NotificationCenter />
          <ViewerMenu viewer={viewer} />
        </div>
      </header>
      <div
        className={tripRequestsStyles["request-status-band"]}
        aria-label="Tóm tắt yêu cầu"
      >
        <span>
          <strong>{counts.open}</strong> đang chờ
        </span>
        <span>
          <strong>{counts.fulfilled}</strong> đã có lịch
        </span>
        <span>
          <strong>{requests.length}</strong> tổng yêu cầu
        </span>
      </div>
      {error && (
        <p className={adminShellStyles["admin-alert"]} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={adminShellStyles["admin-notice"]} role="status">
          {notice}
        </p>
      )}

      <div className={tripRequestsStyles["request-workspace"]}>
        <aside className={tripRequestsStyles["request-rail"]}>
          <div className={adminShellStyles["admin-section-head"]}>
            <h2>Yêu cầu của tôi</h2>
            <Button
              variant="primary"
              className="small"
              type="button"
              onClick={startNew}
            >
              Yêu cầu mới
            </Button>
          </div>
          <div className={tripRequestsStyles["request-rail-list"]}>
            {requests.map((request) => (
              <button
                className={`${tripRequestsStyles["request-rail-item"]} is-${request.state}${selected?.id === request.id && !editor ? " is-active" : ""}`}
                type="button"
                onClick={() => chooseRequest(request)}
                key={request.id}
              >
                <span
                  className={tripRequestsStyles["request-rail-node"]}
                  aria-hidden="true"
                />
                <b>{request.places[0]}</b>
                <small>{formatRequestRange(request)}</small>
                <em>{requestStateLabels[request.state]}</em>
              </button>
            ))}
            {!requests.length && (
              <p className={tripRequestsStyles["request-empty-rail"]}>
                Chưa có yêu cầu nào. Bắt đầu bằng ngày đi và nơi bạn đang nghĩ
                tới.
              </p>
            )}
          </div>
        </aside>

        <section
          className={tripRequestsStyles["request-stage"]}
          aria-live="polite"
        >
          {editor ? (
            <TripRequestForm
              editor={editor}
              busy={busy}
              onChange={(values) =>
                setEditor((current) => ({ ...current, values }))
              }
              onSave={saveRequest}
              onCancel={() => {
                if (leaveEditor()) {
                  setEditor(null);
                  setSelectedId(requests[0]?.id || null);
                }
              }}
            />
          ) : selected ? (
            <article
              className={`${tripRequestsStyles["request-ticket"]} is-${selected.state}`}
            >
              <header className={tripRequestsStyles["request-ticket-head"]}>
                <div>
                  <span>{requestStateLabels[selected.state]}</span>
                  <h2>{selected.places.join(" · ")}</h2>
                </div>
                <div className={tripRequestsStyles["request-ticket-actions"]}>
                  {selected.state === "open" && (
                    <>
                      <Button variant="ghost" type="button" onClick={startEdit}>
                        Sửa yêu cầu
                      </Button>
                      <Button
                        variant="danger"
                        type="button"
                        disabled={busy}
                        onClick={() => changeState(selected, "withdraw")}
                      >
                        Rút yêu cầu
                      </Button>
                    </>
                  )}
                  {selected.state === "withdrawn" && (
                    <Button
                      variant="primary"
                      type="button"
                      disabled={busy}
                      onClick={() => changeState(selected, "restore")}
                    >
                      Khôi phục yêu cầu
                    </Button>
                  )}
                </div>
              </header>
              <TripRequestDetails request={selected} />
            </article>
          ) : (
            <div className={tripRequestsStyles["request-stage-empty"]}>
              <h2>Chọn một yêu cầu</h2>
              <p>Xem chi tiết hoặc tạo yêu cầu mới từ tuyến bên trái.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function TripRequestForm({ editor, busy, onChange, onSave, onCancel }) {
  const values = editor.values;
  const set = (key, value) => onChange({ ...values, [key]: value });
  const updatePlace = (index, value) =>
    set(
      "places",
      values.places.map((place, placeIndex) =>
        placeIndex === index ? value : place,
      ),
    );
  const updateSource = (index, key, value) =>
    set(
      "sources",
      values.sources.map((source, sourceIndex) =>
        sourceIndex === index ? { ...source, [key]: value } : source,
      ),
    );
  return (
    <form
      className={tripRequestsStyles["request-editor"]}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(values);
      }}
    >
      <header>
        <div>
          <span>
            {editor.mode === "new" ? "Yêu cầu mới" : "Đang chỉnh sửa"}
          </span>
          <h2>Bạn muốn đi đâu?</h2>
        </div>
        <Button variant="ghost" type="button" onClick={onCancel}>
          Đóng
        </Button>
      </header>
      <div className={tripRequestsStyles["request-date-fields"]}>
        <label>
          Ngày bắt đầu
          <input
            type="date"
            required
            value={values.startDate}
            onChange={(event) => set("startDate", event.target.value)}
          />
        </label>
        <label>
          Ngày kết thúc
          <input
            type="date"
            required
            min={values.startDate || undefined}
            value={values.endDate}
            onChange={(event) => set("endDate", event.target.value)}
          />
        </label>
      </div>
      <fieldset className={tripRequestsStyles["request-repeatable"]}>
        <legend>Những nơi muốn đi</legend>
        <p>Thêm theo thứ tự ưu tiên. Tối đa 12 địa điểm.</p>
        {values.places.map((place, index) => (
          <div
            className={tripRequestsStyles["request-place-field"]}
            key={index}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <label>
              <span className="sr-only">Địa điểm {index + 1}</span>
              <input
                required
                maxLength={160}
                value={place}
                placeholder={
                  index === 0 ? "Ví dụ: Kamakura" : "Địa điểm tiếp theo"
                }
                onChange={(event) => updatePlace(index, event.target.value)}
              />
            </label>
            {values.places.length > 1 && (
              <Button
                variant="danger"
                type="button"
                aria-label={`Xoá địa điểm ${index + 1}`}
                onClick={() =>
                  set(
                    "places",
                    values.places.filter(
                      (_, placeIndex) => placeIndex !== index,
                    ),
                  )
                }
              >
                Xoá
              </Button>
            )}
          </div>
        ))}
        {values.places.length < 12 && (
          <Button
            variant="ghost"
            className={tripRequestsStyles["request-add-row"]}
            type="button"
            onClick={() => set("places", [...values.places, ""])}
          >
            Thêm địa điểm
          </Button>
        )}
      </fieldset>
      <fieldset className={tripRequestsStyles["request-repeatable"]}>
        <legend>Liên kết tham khảo</legend>
        <p>Không bắt buộc. Tối đa 10 liên kết HTTP(S).</p>
        {values.sources.map((source, index) => (
          <div
            className={tripRequestsStyles["request-source-field"]}
            key={index}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <label>
              Nhãn
              <input
                maxLength={300}
                value={source.label || ""}
                placeholder="Tên nguồn (không bắt buộc)"
                onChange={(event) =>
                  updateSource(index, "label", event.target.value)
                }
              />
            </label>
            <label>
              URL
              <input
                type="url"
                required
                value={source.url}
                placeholder="https://…"
                onChange={(event) =>
                  updateSource(index, "url", event.target.value)
                }
              />
            </label>
            <Button
              variant="danger"
              type="button"
              aria-label={`Xoá liên kết ${index + 1}`}
              onClick={() =>
                set(
                  "sources",
                  values.sources.filter(
                    (_, sourceIndex) => sourceIndex !== index,
                  ),
                )
              }
            >
              Xoá
            </Button>
          </div>
        ))}
        {values.sources.length < 10 && (
          <Button
            variant="ghost"
            className={tripRequestsStyles["request-add-row"]}
            type="button"
            onClick={() =>
              set("sources", [...values.sources, { label: "", url: "" }])
            }
          >
            Thêm liên kết
          </Button>
        )}
      </fieldset>
      <label className={tripRequestsStyles["request-notes-field"]}>
        Ghi chú
        <textarea
          rows={5}
          maxLength={2000}
          value={values.notes}
          placeholder="Mức độ linh hoạt về ngày, điều đặc biệt cần lưu ý…"
          onChange={(event) => set("notes", event.target.value)}
        />
        <span>{values.notes.length}/2000</span>
      </label>
      <Footer>
        <Button variant="ghost" type="button" onClick={onCancel}>
          Huỷ
        </Button>
        <Button variant="primary" disabled={busy}>
          {busy
            ? "Đang lưu…"
            : editor.mode === "new"
              ? "Gửi yêu cầu"
              : "Lưu thay đổi"}
        </Button>
      </Footer>
    </form>
  );
}
