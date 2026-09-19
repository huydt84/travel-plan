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

export function isGoogleMapsUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return ["http:", "https:"].includes(url.protocol) && (
      host === "maps.app.goo.gl"
      || (host === "goo.gl" && url.pathname.startsWith("/maps/"))
      || (/^(?:www\.)?google\.[a-z.]+$/.test(host) && url.pathname.startsWith("/maps"))
      || /^maps\.google\.[a-z.]+$/.test(host)
    );
  } catch {
    return false;
  }
}
