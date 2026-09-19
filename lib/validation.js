import { isGoogleMapsUrl, sourceDetailsFromUrl } from "./source-fields.mjs";
import { isIsoDate, validateActivityInterval } from "./trip-dates.mjs";
import { EXPENSE_CURRENCIES, parseExpenseAmount } from "./expense-money.mjs";

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
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

const reservationContacts = (value) => {
  if (!Array.isArray(value) || value.length > 50) {
    throw new ValidationError("reservationContacts must be an array with at most 50 entries");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ValidationError(`reservationContacts[${index}] must be an object`);
    }
    const name = text(entry.name, `reservationContacts[${index}].name`, { max: 160 });
    const phone = entry.phone == null || entry.phone === ""
      ? ""
      : text(entry.phone, `reservationContacts[${index}].phone`, { max: 80 });
    const link = entry.link == null || entry.link === ""
      ? ""
      : text(entry.link, `reservationContacts[${index}].link`, { max: 2000 });
    if (link) {
      try {
        const parsed = new URL(link);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch {
        throw new ValidationError(`reservationContacts[${index}].link must be a valid HTTP or HTTPS URL`);
      }
    }
    return { name, phone, link };
  });
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
    startDate: optional(body, "startDate", (value) => {
      if (!isIsoDate(value)) throw new ValidationError("startDate must use YYYY-MM-DD");
      return value;
    }, partial),
    endDate: optional(body, "endDate", (value) => {
      if (!isIsoDate(value)) throw new ValidationError("endDate must use YYYY-MM-DD");
      return value;
    }, partial),
    timezone: optional(body, "timezone", (value) => {
      const timezone = text(value, "timezone", { max: 80 });
      try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); }
      catch { throw new ValidationError("timezone must be a valid IANA timezone"); }
      return timezone;
    }, partial),
    location: optional(body, "location", (value) => text(value, "location", { max: 160 }), partial),
    currency: optional(body, "currency", (value) => {
      if (typeof value !== "string" || !EXPENSE_CURRENCIES.includes(value)) {
        throw new ValidationError("currency must be VND, JPY or USD");
      }
      return value;
    }, partial || !hasOwn(body, "currency")),
    moveSchedule: hasOwn(body, "moveSchedule")
      ? (typeof body.moveSchedule === "boolean" ? body.moveSchedule : (() => { throw new ValidationError("moveSchedule must be a boolean"); })())
      : undefined,
    memberEmails: !partial && hasOwn(body, "memberEmails")
      ? (() => {
          if (!Array.isArray(body.memberEmails) || body.memberEmails.length > 50) {
            throw new ValidationError("memberEmails must be an array with at most 50 entries");
          }
          return [...new Set(body.memberEmails.map((value) => {
            const email = text(value, "memberEmail", { max: 320 }).toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("memberEmail must be a valid email");
            return email;
          }))];
        })()
      : undefined,
  };

  if (!partial && result.endDate < result.startDate) throw new ValidationError("endDate must not be before startDate");
  if (partial && result.startDate && result.endDate && result.endDate < result.startDate) {
    throw new ValidationError("endDate must not be before startDate");
  }

  if (partial && Object.values(result).every((value) => value === undefined)) {
    throw new ValidationError("At least one trip field is required");
  }
  return result;
}

export function parseExpenseInput(body, currency, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Request body must be an object");
  const allowed = partial ? ["payerEmail", "amount"] : ["activityId", "payerEmail", "amount"];
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new ValidationError("Request body contains unsupported expense fields");
  const result = {
    activityId: partial || !hasOwn(body, "activityId") ? undefined : positiveId(body.activityId, "activityId"),
    payerEmail: partial && !hasOwn(body, "payerEmail") ? undefined : (() => {
      const email = text(body.payerEmail, "payerEmail", { max: 320 }).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("payerEmail must be valid");
      return email;
    })(),
    amount: partial && !hasOwn(body, "amount") ? undefined : (() => {
      try { return parseExpenseAmount(body.amount, currency).amount; }
      catch (error) { throw new ValidationError(error.message); }
    })(),
  };
  if (!partial && result.activityId === undefined) throw new ValidationError("activityId is required");
  if (partial && result.payerEmail === undefined && result.amount === undefined) throw new ValidationError("At least one expense field is required");
  return result;
}

export function parseExpensePermission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1
    || typeof body.canManageExpenses !== "boolean") {
    throw new ValidationError("Request body must contain only boolean canManageExpenses");
  }
  return { canManageExpenses: body.canManageExpenses };
}

export function parseUserLookup(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "email")) {
    throw new ValidationError("Request body must contain only email");
  }
  const email = text(body.email, "email", { max: 320 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("email must be valid");
  return { email };
}

export function parseScheduleInput(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Request body must be an object");
  const time = (value, field) => {
    if (typeof value !== "string" || !timePattern.test(value)) throw new ValidationError(`${field} must use HH:MM`);
    return value;
  };
  const result = {
    startDate: optional(body, "startDate", (value) => {
      if (!isIsoDate(value)) throw new ValidationError("startDate must use YYYY-MM-DD");
      return value;
    }, partial),
    start: optional(body, "start", time, partial),
    endDate: optional(body, "endDate", (value) => {
      if (!isIsoDate(value)) throw new ValidationError("endDate must use YYYY-MM-DD");
      return value;
    }, partial),
    end: optional(body, "end", time, partial),
    displayEnd: partial && !hasOwn(body, "displayEnd")
      ? undefined
      : (body.displayEnd == null ? null : text(body.displayEnd, "displayEnd", { max: 20 })),
    type: optional(body, "type", (value) => text(value, "type", { max: 40 }), partial),
    icon: optional(body, "icon", (value) => text(value, "icon", { max: 16 }), partial),
    title: optional(body, "title", (value) => text(value, "title", { max: 240 }), partial),
    detail: optional(body, "detail", (value) => text(value, "detail", { min: 0, max: 2000 }), partial),
    reservationContacts: partial && !hasOwn(body, "reservationContacts")
      ? undefined
      : reservationContacts(body.reservationContacts ?? []),
    refs: partial && !hasOwn(body, "refs") ? undefined : parseRefs(body.refs),
    branchId: partial && !hasOwn(body, "branchId")
      ? undefined
      : (body.branchId == null || body.branchId === "" ? null : positiveId(body.branchId, "branchId")),
  };

  if (!partial) {
    try { validateActivityInterval(result); }
    catch (error) { throw new ValidationError(error.message); }
  }
  if (partial && Object.values(result).every((value) => value === undefined)) {
    throw new ValidationError("At least one schedule field is required");
  }
  return result;
}

export function parseBranchGroupInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Request body must be an object");
  const segmentActivityIds = Array.isArray(body.segmentActivityIds)
    ? body.segmentActivityIds.map((value) => positiveId(value, "segmentActivityIds"))
    : null;
  if (!segmentActivityIds?.length || new Set(segmentActivityIds).size !== segmentActivityIds.length) {
    throw new ValidationError("segmentActivityIds must contain unique activity ids");
  }
  return {
    anchorActivityId: body.anchorActivityId == null ? null : positiveId(body.anchorActivityId, "anchorActivityId"),
    segmentActivityIds,
    title: text(body.title, "title", { max: 160 }),
    defaultBranch: parseBranchDefinition(body.defaultBranch, "defaultBranch"),
    alternateBranch: parseBranchDefinition(body.alternateBranch, "alternateBranch"),
  };
}

export function parseBranchInput(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Request body must be an object");
  if (!partial) return parseBranchDefinition(body, "branch");
  const result = {
    label: optional(body, "label", (value) => text(value, "label", { max: 80 }), true),
    condition: optional(body, "condition", (value) => text(value, "condition", { max: 240 }), true),
    isDefault: hasOwn(body, "isDefault")
      ? (typeof body.isDefault === "boolean" ? body.isDefault : (() => { throw new ValidationError("isDefault must be a boolean"); })())
      : undefined,
  };
  if (Object.values(result).every((value) => value === undefined)) throw new ValidationError("At least one branch field is required");
  return result;
}

export function parseBranchSelectionInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Request body must be an object");
  return { branchId: positiveId(body.branchId, "branchId") };
}

export function parseBranchUnwrapInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Request body must be an object");
  return { keepBranchId: positiveId(body.keepBranchId, "keepBranchId") };
}

export function parseSourceInput(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Request body must be an object");
  const kind = partial && !hasOwn(body, "kind") ? undefined : (body.kind ?? "reference");
  if (kind !== undefined && !["reference", "route"].includes(kind)) throw new ValidationError("kind must be reference or route");
  const routeStart = kind === "route" ? text(body.routeStart, "routeStart", { max: 160 }) : undefined;
  const routeEnd = kind === "route" ? text(body.routeEnd, "routeEnd", { max: 160 }) : undefined;
  let title;
  if (kind === "route") {
    if (body.title != null && typeof body.title !== "string") throw new ValidationError("title must be a string");
    title = body.title?.trim() ? text(body.title, "title", { max: 300 }) : `${routeStart} → ${routeEnd}`;
    if (title.length > 300) throw new ValidationError("route title must be at most 300 characters");
  } else {
    title = optional(body, "title", (value) => text(value, "title", { max: 300 }), partial);
  }
  const source = partial && !hasOwn(body, "url") ? null : sourceDetailsFromUrl(body.url);
  if ((!partial || hasOwn(body, "url")) && !source) throw new ValidationError("url must be a valid HTTP or HTTPS URL");
  if (kind === "route" && !isGoogleMapsUrl(source?.url)) throw new ValidationError("url must be a Google Maps URL");
  if (partial && title === undefined && kind === undefined && !source) throw new ValidationError("At least one source field is required");
  return { title, ...(kind === undefined ? {} : { kind }), ...(routeStart === undefined ? {} : { routeStart, routeEnd }), ...(source || {}) };
}

export function parsePlaceInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Request body must be an object");
  }
  const nullableText = (value, field, max) => value == null || value === "" ? null : text(value, field, { max });
  const coordinate = (value, field, min, max) => {
    if (value == null || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
      throw new ValidationError(`${field} must be between ${min} and ${max}`);
    }
    return number;
  };
  const latitude = coordinate(body.latitude, "latitude", -90, 90);
  const longitude = coordinate(body.longitude, "longitude", -180, 180);
  if ((latitude === null) !== (longitude === null)) {
    throw new ValidationError("latitude and longitude must be provided together");
  }
  const website = nullableText(body.website, "website", 2000);
  if (website && !sourceDetailsFromUrl(website)) {
    throw new ValidationError("website must be a valid HTTP or HTTPS URL");
  }
  const googleMapsUrl = nullableText(body.googleMapsUrl, "googleMapsUrl", 2000);
  if (googleMapsUrl && !sourceDetailsFromUrl(googleMapsUrl)) {
    throw new ValidationError("googleMapsUrl must be a valid HTTP or HTTPS URL");
  }
  return {
    name: text(body.name, "name", { max: 240 }),
    address: body.address == null || body.address === "" ? "" : text(body.address, "address", { max: 1000 }),
    latitude,
    longitude,
    website,
    googleMapsUrl,
    googlePlaceId: nullableText(body.googlePlaceId, "googlePlaceId", 500),
    notes: body.notes == null || body.notes === "" ? "" : text(body.notes, "notes", { min: 0, max: 2000 }),
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

export function parseTripRequestInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Request body must be an object");
  }
  const startDate = body.startDate;
  const endDate = body.endDate;
  if (!isIsoDate(startDate)) throw new ValidationError("startDate must use YYYY-MM-DD");
  if (!isIsoDate(endDate)) throw new ValidationError("endDate must use YYYY-MM-DD");
  if (endDate < startDate) throw new ValidationError("endDate must not be before startDate");

  if (!Array.isArray(body.places) || body.places.length < 1 || body.places.length > 12) {
    throw new ValidationError("places must contain between 1 and 12 items");
  }
  const places = body.places.map((place, index) => text(place, `places[${index}]`, { max: 160 }));

  const rawSources = body.sources ?? [];
  if (!Array.isArray(rawSources) || rawSources.length > 10) {
    throw new ValidationError("sources must contain at most 10 items");
  }
  const sources = rawSources.map((source, index) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new ValidationError(`sources[${index}] must be an object`);
    }
    const parsed = sourceDetailsFromUrl(source.url);
    if (!parsed) throw new ValidationError(`sources[${index}].url must be a valid HTTP or HTTPS URL`);
    const label = typeof source.label === "string" && source.label.trim()
      ? text(source.label, `sources[${index}].label`, { max: 300 })
      : null;
    return { label, url: parsed.url };
  });

  const notes = body.notes == null || body.notes === ""
    ? ""
    : text(body.notes, "notes", { min: 0, max: 2000 });
  return { startDate, endDate, places, sources, notes };
}

export function parseTripRequestMutation(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Request body must be an object");
  }
  if (body.action === "update") return { action: "update", request: parseTripRequestInput(body.request) };
  if (["withdraw", "restore"].includes(body.action) && Object.keys(body).length === 1) {
    return { action: body.action };
  }
  throw new ValidationError("action must be update, withdraw or restore");
}

export function parseAdminTripRequestMutation(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Request body must be an object");
  }
  if (body.action === "decline") {
    const reason = body.reason == null || body.reason === ""
      ? ""
      : text(body.reason, "reason", { min: 0, max: 300 });
    return { action: "decline", reason };
  }
  if (body.action === "restore" && Object.keys(body).length === 1) return { action: "restore", reason: "" };
  throw new ValidationError("action must be decline or restore");
}

export function parseTripRequestFulfillment(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Request body must be an object");
  }
  if (Object.keys(body).length !== 1) throw new ValidationError("Provide exactly one tripSlug");
  return { tripSlug: text(body.tripSlug, "tripSlug", { max: 100 }) };
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

export function parseDisplayName(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Request body must be an object");
  }
  if (Object.keys(body).length !== 1 || !hasOwn(body, "displayName")) {
    throw new ValidationError("Provide exactly one displayName");
  }
  return { displayName: text(body.displayName, "displayName", { max: 120 }) };
}

const parseRefs = (value) => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((ref) => !Number.isInteger(ref) || ref <= 0)) {
    throw new ValidationError("refs must be an array of positive integers");
  }
  return [...new Set(value)];
};

const positiveId = (value, field) => {
  const normalized = String(value);
  if (!/^\d+$/.test(normalized) || Number(normalized) <= 0) throw new ValidationError(`${field} must be a positive integer`);
  return normalized;
};

const parseBranchDefinition = (value, field) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError(`${field} must be an object`);
  return {
    key: value.key == null ? null : (() => {
      const key = text(value.key, `${field}.key`, { max: 120 });
      if (!slugPattern.test(key)) throw new ValidationError(`${field}.key must use lowercase letters, numbers and single hyphens`);
      return key;
    })(),
    label: text(value.label, `${field}.label`, { max: 80 }),
    condition: text(value.condition, `${field}.condition`, { max: 240 }),
  };
};
