import Ajv from "ajv";
import { AssistantFault } from "./errors.mjs";

const ajv = new Ajv({ allErrors: true, strict: false });
const uuid = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const time = "^(?:[01]\\d|2[0-3]):[0-5]\\d$";

export const activityValueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    start: { type: "string", pattern: time },
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
            required: ["start", "end", "type", "icon", "title", "detail"],
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

export const turnBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["clientTurnId", "message"],
  properties: {
    conversationId: { type: ["string", "null"], pattern: uuid },
    clientTurnId: { type: "string", pattern: uuid },
    message: { type: "string", minLength: 1, maxLength: 4000 },
  },
};

export const confirmBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["confirmationToken"],
  properties: { confirmationToken: { type: "string", minLength: 20, maxLength: 1024 } },
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
