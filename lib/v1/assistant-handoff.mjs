const triggers = ["chồng iu", "chồng yêu", "vợ iu", "vợ yêu", "chồng ơi"];

export function matchesAssistantHandoffTrigger(value) {
  if (typeof value !== "string") return false;
  const normalized = value.normalize("NFC").toLocaleLowerCase("vi-VN");
  return triggers.some((trigger) => normalized.includes(trigger));
}

