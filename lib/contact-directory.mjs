const phoneLinePattern = /^(.+?)\s+[—–]\s+(\+?[\d() -]{8,}\d)$/;

export function parseContactDirectory(detail) {
  if (typeof detail !== "string") return null;
  const lines = detail.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;

  const contacts = lines.map((line) => {
    const match = line.match(phoneLinePattern);
    if (!match) return null;
    const phone = match[2].trim();
    return {
      name: match[1].trim(),
      phone,
      dial: phone.replace(/(?!^)\+/g, "").replace(/[^\d+]/g, ""),
    };
  });

  return contacts.every(Boolean) ? contacts : null;
}
