import Link from "next/link";
import { ActionIcon } from "./Icons";

export const requestStateLabels = {
  open: "Đang chờ",
  fulfilled: "Đã có lịch",
  declined: "Không thực hiện",
  withdrawn: "Đã rút",
};

const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

export const formatRequestDate = (value) => dateFormatter.format(new Date(`${value}T00:00:00Z`));
export const formatRequestRange = (request) => request.startDate === request.endDate
  ? formatRequestDate(request.startDate)
  : `${formatRequestDate(request.startDate)} — ${formatRequestDate(request.endDate)}`;

export default function TripRequestDetails({ request, admin = false }) {
  return (
    <div className="request-detail-body">
      <div className="request-date-board">
        <span>Thời gian mong muốn</span>
        <strong>{formatRequestRange(request)}</strong>
      </div>

      <section className="request-route" aria-labelledby={`request-${request.id}-places`}>
        <h3 id={`request-${request.id}-places`}>{request.places.length} điểm muốn đi</h3>
        <ol>{request.places.map((place, index) => (
          <li key={`${place}-${index}`}><span aria-hidden="true" /><b>{place}</b></li>
        ))}</ol>
      </section>

      {request.notes && (
        <section className="request-notes">
          <h3>Ghi chú cho người lên lịch</h3>
          <p>{request.notes}</p>
        </section>
      )}

      <section className="request-sources" aria-labelledby={`request-${request.id}-sources`}>
        <h3 id={`request-${request.id}-sources`}>Nguồn tham khảo</h3>
        {request.sources.length ? <ol>{request.sources.map((source, index) => (
          <li key={`${source.url}-${index}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <a href={source.url} target="_blank" rel="noreferrer">
              <b>{source.label || new URL(source.url).hostname}</b>
              <small>{new URL(source.url).hostname}</small>
              <ActionIcon name="external" />
            </a>
          </li>
        ))}</ol> : <p>Chưa có liên kết tham khảo.</p>}
      </section>

      {request.state === "declined" && (
        <div className="request-decision" role="note">
          <strong>Yêu cầu chưa thể thực hiện</strong>
          <p>{request.decisionReason || "Admin chưa ghi thêm lý do."}</p>
        </div>
      )}

      {request.trip && (
        <div className="request-fulfillment">
          <div><span>Lịch trình đã sẵn sàng</span><strong>{request.trip.title}</strong></div>
          <Link href={`/?trip=${encodeURIComponent(request.trip.slug)}`}>Xem lịch trình <ActionIcon name="right" /></Link>
        </div>
      )}

      {admin && (
        <dl className="request-audit">
          <div><dt>Người yêu cầu</dt><dd>{request.requester.name}<small>{request.requester.email}</small></dd></div>
          <div><dt>Mã yêu cầu</dt><dd>#{request.id}</dd></div>
          <div><dt>Trạng thái</dt><dd>{requestStateLabels[request.state]}</dd></div>
        </dl>
      )}
    </div>
  );
}
