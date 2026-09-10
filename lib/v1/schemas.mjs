import Ajv from "ajv";
import { AssistantFault } from "./errors.mjs";
import { ASSISTANT_TOOL_NAMES } from "./tool-catalog.mjs";

const ajv = new Ajv({ allErrors: true, strict: false });
const uuid = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const time = "^(?:[01]\\d|2[0-3]):[0-5]\\d$";
const date = "^\\d{4}-\\d{2}-\\d{2}$";

export const activityValueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    startDate: { type: "string", pattern: date },
    start: { type: "string", pattern: time },
    endDate: { type: "string", pattern: date },
    end: { type: "string", pattern: time },
    displayEnd: { type: ["string", "null"], maxLength: 20 },
    type: { type: "string", minLength: 1, maxLength: 40 },
    icon: { type: "string", minLength: 1, maxLength: 16 },
    title: { type: "string", minLength: 1, maxLength: 240 },
    detail: { type: "string", minLength: 1, maxLength: 2000 },
  },
};

const sourceReferenceSchema = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["sourceNumber"], properties: { sourceNumber: { type: "integer", minimum: 1 } } },
    { type: "object", additionalProperties: false, required: ["draftId"], properties: { draftId: { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$" } } },
  ],
};

export const planOperationsSchema = {
  type: "array",
  minItems: 1,
  maxItems: 24,
  items: {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "draftId", "title", "url"],
        properties: {
          kind: { const: "source.add" },
          draftId: { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$" },
          title: { type: "string", minLength: 1, maxLength: 300 },
          url: { type: "string", minLength: 8, maxLength: 2000 },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "draftId", "lane", "value"],
        properties: {
          kind: { const: "activity.add" },
          draftId: { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$" },
          lane: {
            oneOf: [
              { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { const: "backbone" } } },
              { type: "object", additionalProperties: false, required: ["kind", "branchKey"], properties: { kind: { const: "branch" }, branchKey: { type: "string", minLength: 1, maxLength: 120 } } },
            ],
          },
          value: {
            ...activityValueSchema,
            required: ["startDate", "start", "endDate", "end", "type", "icon", "title", "detail"],
            properties: { ...activityValueSchema.properties, refs: { type: "array", maxItems: 20, items: sourceReferenceSchema } },
          },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "itemKey", "set"],
        properties: {
          kind: { const: "activity.update" },
          itemKey: { type: "string", minLength: 1, maxLength: 120 },
          set: {
            ...activityValueSchema,
            minProperties: 1,
            properties: { ...activityValueSchema.properties, refs: { type: "array", maxItems: 20, items: sourceReferenceSchema } },
          },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "itemKey"],
        properties: { kind: { const: "activity.remove" }, itemKey: { type: "string", minLength: 1, maxLength: 120 } },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "itemKey", "refs"],
        properties: {
          kind: { const: "activity.setSources" },
          itemKey: { type: "string", minLength: 1, maxLength: 120 },
          refs: { type: "array", maxItems: 20, items: sourceReferenceSchema },
        },
      },
    ],
  },
};

export const contextRefSchema = {
  type: "object", additionalProperties: false, required: ["kind", "id"],
  properties: { kind: { enum: ["trip", "activity", "source", "contribution", "place"] }, id: { type: "string", minLength: 1, maxLength: 300 } },
};
export const contextRefsSchema = { type: "array", maxItems: 20, items: contextRefSchema };
export const pinsBodySchema = { type: "object", additionalProperties: false, required: ["pins", "version"],
  properties: { pins: contextRefsSchema, version: { type: "integer", minimum: 0 } } };

export const turnBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["clientTurnId", "message"],
  properties: {
    conversationId: { type: ["string", "null"], pattern: uuid },
    clientTurnId: { type: "string", pattern: uuid },
    retryOfTurnId: { type: ["string", "null"], pattern: uuid },
    mentions: contextRefsSchema,
    initialPins: contextRefsSchema,
    message: { type: "string", minLength: 1, maxLength: 4000, pattern: "\\S" },
    locale: { type: ["string", "null"], pattern: "^[a-z]{2}(?:-[A-Za-z0-9]+)?$", maxLength: 10 },
    allowedTools: { type: "array", maxItems: ASSISTANT_TOOL_NAMES.length, uniqueItems: true, items: { enum: ASSISTANT_TOOL_NAMES } },
  },
};

export const handoffReplySchema = {
  type: "object", additionalProperties: false, required: ["clientMessageId", "message"],
  properties: {
    clientMessageId: { type: "string", pattern: uuid },
    message: { type: "string", minLength: 1, maxLength: 4000, pattern: "\\S" },
  },
};

export const confirmBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["confirmationToken"],
  properties: { confirmationToken: { type: "string", minLength: 20, maxLength: 1024 } },
};

export const reviseBodySchema = {
  type: "object", additionalProperties: false, required: ["expectedDigest", "edits"],
  properties: {
    expectedDigest: { type: "string", pattern: "^[0-9a-f]{64}$" },
    edits: {
      type: "array", minItems: 1, maxItems: 96,
      items: {
        type: "object", additionalProperties: false, required: ["targetKey", "field", "value"],
        properties: {
          targetKey: { type: "string", pattern: "^(?:trip|activity|source|place):(?:id:[1-9][0-9]*|draft:[A-Za-z][A-Za-z0-9_-]{0,63})$", maxLength: 240 },
          field: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9]{0,31}$" },
          value: { oneOf: [{ type: "string", maxLength: 2000 }, { type: "number" }, { type: "null" }] },
        },
      },
    },
  },
};

const validators = new WeakMap();
export function validateSchema(schema, value, label = "Dữ liệu") {
  let validate = validators.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    validators.set(schema, validate);
  }
  if (!validate(value)) {
    const detail = validate.errors?.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
    throw new AssistantFault("INVALID_INPUT", `${label} không hợp lệ`, { status: 400, details: detail });
  }
  return value;
}

export const workspaceQuerySchema = {
  type: "object", additionalProperties: false,
  properties: {
    conversationId: { type: ["string", "null"], pattern: uuid },
    clientTurnId: { type: ["string", "null"], pattern: uuid },
    before: { type: ["string", "null"], pattern: "^[A-Za-z0-9_-]+$", maxLength: 300 },
    cursor: { type: "object", additionalProperties: false, required: ["createdAt", "id"], properties: {
      createdAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T.*Z$", maxLength: 30 },
      id: { type: "string", pattern: uuid },
    } },
  },
};

export function validatePlanOperations(operations) {
  validateSchema({ ...planOperationsSchema, items: {} }, operations, "Danh sách thay đổi");
  for (const operation of operations) {
    const schema = planOperationsSchema.items.oneOf.find((item) => item.properties.kind.const === operation?.kind);
    if (!schema) throw new AssistantFault("INVALID_INPUT", "Loại thay đổi không hợp lệ", { details: "Use source.add, activity.add, activity.update, activity.remove, or activity.setSources." });
    validateSchema(schema, operation, operation.kind);
  }
  return operations;
}
