export function sourceDetailsFromUrl(value) {
  if (typeof value !== "string") return null;

  const url = value.trim();
  if (!url || url.length > 2000) return null;

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) return null;
    return {
      url,
      host: parsed.hostname.replace(/^www\./, ""),
    };
  } catch {
    return null;
  }
}
