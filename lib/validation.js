import { sourceDetailsFromUrl } from "./source-fields.mjs";

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const text = (value, field, { min = 1, max = 500 } = {}) => {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
    throw new ValidationError(`${field} must be a string between ${min} and ${max} characters`);
  }
  return value.trim();
};

const optional = (body, key, parser, partial) => {
  if (partial && !hasOwn(body, key)) return undefined;
  return parser(body[key], key);
};

export class ValidationError extends Error {}

export async function readJsonBody(request) {
  try { return await request.json(); }
  catch { throw new ValidationError("Request body must be valid JSON"); }
}

export function parseTripInput(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Request body must be an object");
  const result = {
    slug: optional(body, "slug", (value) => {
      const slug = text(value, "slug", { max: 100 });
      if (!slugPattern.test(slug)) throw new ValidationError("slug must use lowercase letters, numbers and single hyphens");
      return slug;
    }, partial),
    title: optional(body, "title", (value) => text(value, "title", { max: 160 }), partial),
    date: optional(body, "date", (value) => {
      if (typeof value !== "string" || !datePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
        throw new ValidationError("date must use YYYY-MM-DD");
      }
      return value;
    }, partial),
    timezone: optional(body, "timezone", (value) => {
      const timezone = text(value, "timezone", { max: 80 });
      try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); }
      catch { throw new ValidationError("timezone must be a valid IANA timezone"); }
      return timezone;
    }, partial),
    location: optional(body, "location", (value) => text(value, "location", { max: 160 }), partial),
  };

  if (partial && Object.values(result).every((value) => value === undefined)) {
    throw new ValidationError("At least one trip field is required");
  }
  return result;
}

export function parseScheduleInput(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Request body must be an object");
  const time = (value, field) => {
    if (typeof value !== "string" || !timePattern.test(value)) throw new ValidationError(`${field} must use HH:MM`);
    return value;
  };
  const result = {
    start: optional(body, "start", time, partial),
    end: optional(body, "end", time, partial),
    displayEnd: partial && !hasOwn(body, "displayEnd")
      ? undefined
      : (body.displayEnd == null ? null : text(body.displayEnd, "displayEnd", { max: 20 })),
    type: optional(body, "type", (value) => text(value, "type", { max: 40 }), partial),
    icon: optional(body, "icon", (value) => text(value, "icon", { max: 16 }), partial),
    title: optional(body, "title", (value) => text(value, "title", { max: 240 }), partial),
    detail: optional(body, "detail", (value) => text(value, "detail", { max: 2000 }), partial),
    refs: partial && !hasOwn(body, "refs") ? undefined : parseRefs(body.refs),
  };

  if (!partial && result.end <= result.start) throw new ValidationError("end must be later than start");
  if (partial && Object.values(result).every((value) => value === undefined)) {
    throw new ValidationError("At least one schedule field is required");
  }
  return result;
}

export function parseSourceInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Request body must be an object");
  const source = sourceDetailsFromUrl(body.url);
  if (!source) throw new ValidationError("url must be a valid HTTP or HTTPS URL");
  return {
    title: text(body.title, "title", { max: 300 }),
    ...source,
  };
}

export function parseSuggestionInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Request body must be an object");
  const kind = body.kind ?? "suggestion";
  if (!["comment", "suggestion"].includes(kind)) {
    throw new ValidationError("kind must be comment or suggestion");
  }
  let activityId = null;
  if (body.activityId != null && body.activityId !== "") {
    const numericId = Number(body.activityId);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) {
      throw new ValidationError("activityId must be a positive integer");
    }
    activityId = numericId;
  }
  return {
    kind,
    activityId,
    body: text(body.body, "body", { min: 2, max: 2000 }),
  };
}

export function parseSuggestionStatus(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Request body must be an object");
  if (!["open", "accepted", "resolved", "rejected"].includes(body.status)) {
    throw new ValidationError("status must be open, accepted, resolved or rejected");
  }
  return { status: body.status };
}

export function parseSuggestionMutation(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Request body must be an object");
  }
  const hasStatus = hasOwn(body, "status");
  const hasHidden = hasOwn(body, "hidden");
  if (Number(hasStatus) + Number(hasHidden) !== 1 || Object.keys(body).length !== 1) {
    throw new ValidationError("Provide exactly one of status or hidden");
  }
  if (hasStatus) return parseSuggestionStatus(body);
  if (typeof body.hidden !== "boolean") throw new ValidationError("hidden must be a boolean");
  return { hidden: body.hidden };
}

export function parseUserRole(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Request body must be an object");
  }
  if (Object.keys(body).length !== 1 || !["member", "admin"].includes(body.role)) {
    throw new ValidationError("role must be member or admin");
  }
  return { role: body.role };
}

const parseRefs = (value) => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((ref) => !Number.isInteger(ref) || ref <= 0)) {
    throw new ValidationError("refs must be an array of positive integers");
  }
  return [...new Set(value)];
};
