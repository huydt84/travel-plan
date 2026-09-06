const COPY = {
  vi: { default: "Lịch trình chuyến đi", before: "Sắp bắt đầu", active: "Đang diễn ra", gap: "Đang chờ", after: "Đã kết thúc" },
  en: { default: "Trip schedule", before: "Starting soon", active: "In progress", gap: "Waiting", after: "Completed" },
  ja: { default: "旅行スケジュール", before: "まもなく開始", active: "進行中", gap: "待機中", after: "完了" },
};

export function getTripPageTitle({ mode, tripTitle, activityTitle, locale = "vi" }) {
  const copy = COPY[locale] || COPY.vi;
  const context = tripTitle ? ` · ${tripTitle}` : "";

  if (!mode) return `${copy.default}${context}`;

  const status = copy[mode] || copy.default;

  const activity = activityTitle && mode !== "after" ? ` · ${activityTitle}` : "";
  return `${status}${activity}${context}`;
}
