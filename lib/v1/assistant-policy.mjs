import { AssistantFault } from "./errors.mjs";

export const ASSISTANT_MODELS = Object.freeze([
  "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite",
]);
export const thinkingOptions = (model) => ["default", ...([ASSISTANT_MODELS[0], ASSISTANT_MODELS[1]].includes(model) ? [] : ["minimal"]), "low", "medium", "high"];
export const initialModel = (model) => ASSISTANT_MODELS.includes(model) ? model : "gemini-3.6-flash";
export const generationConfig = (effort) => effort && effort !== "default" ? { generation_config: { thinking_level: effort } } : {};

export function validatePolicy(value, override = false) {
  const fail = () => { throw new AssistantFault("INVALID_INPUT", "Cài đặt trợ lý không hợp lệ. Kiểm tra hạn mức và mức suy nghĩ."); };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const keys = ["enabled", "daily", "weekly", "model", "effort", "version"];
  if (Object.keys(value).some((key) => !keys.includes(key)) || !Number.isSafeInteger(value.version) || value.version < 0) fail();
  if (typeof value.enabled !== "boolean") fail();
  for (const key of ["daily", "weekly"]) {
    if (value[key] !== null && !(override && value[key] === "inherit") && !(Number.isInteger(value[key]) && value[key] > 0 && value[key] <= 2147483647)) fail();
  }
  if (!(override && value.model === "inherit" && value.effort === "default") &&
    (!ASSISTANT_MODELS.includes(value.model) || !thinkingOptions(value.model).includes(value.effort))) fail();
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

export const policyDatabaseFault = (error) => {
  const faults = {
    PA001: ["ASSISTANT_DISABLED", "Lượt sử dụng trợ lý đã bị tắt. Bạn vẫn có thể đọc lịch sử.", 403],
    PA002: ["ASSISTANT_QUOTA", "Bạn đã dùng hết hạn mức trợ lý. Xem thời gian đặt lại trong cài đặt sử dụng.", 429],
    PA003: ["PILOT_FORBIDDEN", "Chỉ owner và admin mới được sử dụng trợ lý.", 403],
    PA004: ["POLICY_CONFLICT", "Cài đặt đã thay đổi. Tải lại trước khi lưu.", 409],
  };
  const entry = faults[error?.code];
  return entry ? new AssistantFault(entry[0], entry[1], { status: entry[2] }) : null;
};
