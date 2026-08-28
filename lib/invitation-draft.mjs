import { formatDateLabel, formatTripDateRange } from "./trip-dates.mjs";

const cleanLine = (value) => String(value ?? "").trim().replace(/[\r\n]+/g, " ");
const scheduleEnd = (item) => cleanLine(item.displayEnd) || cleanLine(item.end);

export const formatInvitationTripDate = (trip) => formatTripDateRange(trip, { dateStyle: "full" });

const invitationScheduleLines = (trip, itinerary) => {
  let currentDate = null;
  return itinerary.flatMap((item) => {
    const lines = [];
    if (item.startDate !== currentDate) {
      currentDate = item.startDate;
      lines.push(`Ngày ${formatDateLabel(item.startDate, trip.timezone, { weekday: "long" })}`);
    }
    const overnight = item.endDate !== item.startDate
      ? ` → ${formatDateLabel(item.endDate, trip.timezone, { weekday: "short" })} ${scheduleEnd(item)}`
      : (scheduleEnd(item) ? `–${scheduleEnd(item)}` : "");
    lines.push(`${item.start}${overnight} — ${cleanLine(item.title)}`);
    if (cleanLine(item.detail)) lines.push(`  ${cleanLine(item.detail)}`);
    return lines;
  });
};

export function createInvitationDraft({ trip, itinerary, inviter, url }) {
  const inviterName = cleanLine(inviter?.name || inviter?.email || "Mình");
  const tripDate = formatInvitationTripDate(trip);
  const firstItem = itinerary[0];
  const invitationTime = firstItem ? `${firstItem.start}, ${tripDate}` : tripDate;
  const scheduleLines = itinerary.length
    ? invitationScheduleLines(trip, itinerary)
    : ["Lịch trình đang được hoàn thiện."];

  return {
    subject: `${inviterName} rủ bạn đi ${cleanLine(trip.location)} vào ${tripDate}`,
    message: [
      "Xin chào,",
      "",
      `Bạn có muốn đi ${cleanLine(trip.location)} cùng mình vào ${invitationTime} không?`,
      "",
      cleanLine(trip.title),
      "Lịch trình dự kiến:",
      ...scheduleLines,
      "",
      `Xem chi tiết và phản hồi: ${url}`,
      "",
      "Thân,",
      inviterName,
    ].join("\n"),
  };
}
