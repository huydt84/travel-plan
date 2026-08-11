const cleanLine = (value) => String(value ?? "").trim().replace(/[\r\n]+/g, " ");
const scheduleEnd = (item) => cleanLine(item.displayEnd) || cleanLine(item.end);

export const formatInvitationTripDate = (trip) => new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "full",
  timeZone: trip.timezone,
}).format(new Date(`${trip.date}T12:00:00Z`));

export function createInvitationDraft({ trip, itinerary, inviter, url }) {
  const inviterName = cleanLine(inviter?.name || inviter?.email || "Mình");
  const tripDate = formatInvitationTripDate(trip);
  const firstItem = itinerary[0];
  const invitationTime = firstItem ? `${firstItem.start}, ${tripDate}` : tripDate;
  const scheduleLines = itinerary.length
    ? itinerary.flatMap((item) => [
        `${item.start}${scheduleEnd(item) ? `–${scheduleEnd(item)}` : ""} — ${cleanLine(item.title)}`,
        ...(cleanLine(item.detail) ? [`  ${cleanLine(item.detail)}`] : []),
      ])
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
