import { AssistantFault } from "./errors.mjs";

export function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function validateEvidenceText(text, citations) {
  const ids = new Set(citations.map((item) => item.id));
  if (citations.some((item) => !safeSourceUrl(item.url)) ||
      [...text.matchAll(/\[(E\d+)\]/g)].some((match) => !ids.has(match[1]))) {
    throw new AssistantFault("INVALID_EVIDENCE", "Câu trả lời có nguồn chưa được xác minh; hãy thử lại", { status: 502, retryable: true });
  }
}
