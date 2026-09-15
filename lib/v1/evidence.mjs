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

export function isGroundingRedirectUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      url.hostname.toLowerCase() === "vertexaisearch.cloud.google.com" &&
      url.pathname.startsWith("/grounding-api-redirect/");
  } catch { return false; }
}

export function safeEvidence(item) {
  if (item.kind !== "context") return safeSourceUrl(item.url);
  if (item.ref?.kind === "collection") return /^[1-9][0-9]*$/.test(item.ref.id) && /^\/admin\/collections\?collection=[1-9][0-9]*$/.test(item.url);
  return Boolean(item.ref && ["trip", "activity", "source", "contribution"].includes(item.ref.kind)
    && /^[1-9][0-9]*$/.test(item.ref.id) && /^\/\?trip=[A-Za-z0-9%_.~-]+(?:#[A-Za-z0-9_-]+)?$/.test(item.url));
}

export function validateEvidenceText(text, citations) {
  const ids = new Set(citations.map((item) => item.id));
  if (citations.some((item) => !safeEvidence(item)) ||
      [...text.matchAll(/\[(E\d+(?:\s*,\s*E\d+)*)\]/g)].some((match) => match[1].split(/\s*,\s*/).some((id) => !ids.has(id)))) {
    throw new AssistantFault("INVALID_EVIDENCE", "Câu trả lời có nguồn chưa được xác minh; hãy thử lại", { status: 502, retryable: true });
  }
}
