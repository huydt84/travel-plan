import { activityValueSchema, validateSchema } from "./schemas.mjs";

const text = (maxLength, minLength = 1) => ({ type: "string", minLength, maxLength, ...(minLength ? { pattern: "\\S" } : {}) });
const id = { type: "string", pattern: "^[1-9][0-9]*$" };
const draftId = { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$" };
const object = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
export const resourceReferenceSchema = { oneOf: [object({ id }, ["id"]), object({ draftId }, ["draftId"])] };
const fields = {
  trip: { slug: { ...text(100), pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }, title: text(160), startDate: text(10), endDate: text(10), timezone: text(80), location: text(160) },
  source: { title: text(300), url: text(2000, 8) },
  place: { name: text(240), address: text(500), latitude: { type: ["number", "null"], minimum: -90, maximum: 90 }, longitude: { type: ["number", "null"], minimum: -180, maximum: 180 }, website: { type: ["string", "null"], maxLength: 2000 }, googlePlaceId: { type: ["string", "null"], pattern: "^[A-Za-z0-9_-]{5,300}$" }, notes: text(2000, 0) },
  activity: { ...activityValueSchema.properties, title: text(240), detail: text(2000,0), type: text(40), icon: text(16), sources: { type: "array", maxItems: 20, uniqueItems: true, items: resourceReferenceSchema }, place: { anyOf: [resourceReferenceSchema, { type: "null" }] }, branchId: { anyOf: [id, { type: "null" }] } },
};
const required = { trip: Object.keys(fields.trip), source: ["title", "url"], place: ["name", "address"], activity: ["startDate", "start", "endDate", "end", "type", "icon", "title"] };
export const batchSchema = object({ operations: {
  type: "array", minItems: 1, maxItems: 24, items: { oneOf: Object.entries(fields).flatMap(([resource, properties]) => [
    object({ kind: { const: `${resource}.create` }, draftId, ...(resource === "trip" ? {} : { trip: resourceReferenceSchema }), value: object(properties, required[resource]) }, ["kind", "draftId", "value", ...(resource === "trip" ? [] : ["trip"])]),
    object({ kind: { const: `${resource}.update` }, target: object({ id }, ["id"]), ...(resource === "trip" ? {} : { trip: resourceReferenceSchema }), set: { ...object(resource === "activity" ? Object.fromEntries(Object.entries(properties).filter(([key]) => key !== "branchId")) : properties), minProperties: 1 } }, ["kind", "target", "set", ...(resource === "trip" ? [] : ["trip"])]),
  ]) },
} }, ["operations"]);

export const validateBatch = (args) => validateSchema(batchSchema, args, "Nhóm thay đổi");
