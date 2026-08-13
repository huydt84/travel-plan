const DEFAULT_TITLE = "Lịch trình chuyến đi";

export function getTripPageTitle({ mode, tripTitle, activityTitle }) {
  const context = tripTitle ? ` · ${tripTitle}` : "";

  if (!mode) return `${DEFAULT_TITLE}${context}`;

  const status = {
    before: "Sắp bắt đầu",
    active: "Đang diễn ra",
    gap: "Đang chờ",
    after: "Đã kết thúc",
  }[mode] || DEFAULT_TITLE;

  const activity = activityTitle && mode !== "after" ? ` · ${activityTitle}` : "";
  return `${status}${activity}${context}`;
}
