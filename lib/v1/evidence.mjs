import { AssistantFault } from "./errors.mjs";

export function remapEvidenceText(text, ids) {
  return text.replace(/\[(E\d+(?:\s*,\s*E\d+)*)\]/g, (_, group) =>
    `[${group.split(/\s*,\s*/).map((id) => ids.get(id) || id).join(", ")}]`);
}

export function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function validateEvidenceText(text, citations) {
  const ids = new Set(citations.map((item) => item.id));
  if (citations.some((item) => !safeSourceUrl(item.url)) ||
      [...text.matchAll(/\[(E\d+(?:\s*,\s*E\d+)*)\]/g)].some((match) => match[1].split(/\s*,\s*/).some((id) => !ids.has(id)))) {
    throw new AssistantFault("INVALID_EVIDENCE", "Câu trả lời có nguồn chưa được xác minh; hãy thử lại", { status: 502, retryable: true });
  }
}
