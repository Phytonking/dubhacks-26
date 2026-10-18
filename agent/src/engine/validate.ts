import type { JsonSchema } from "./types";

// Minimal JSON-Schema check for tool arguments (string/number/integer/boolean/array/object, enum, length, range, required).
// Anything the model sends that does not fit is returned to it as an error; it never reaches tool code.
export function validateArgs(schema: JsonSchema, args: unknown): string | null {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return "arguments must be a JSON object";
  const a = args as Record<string, unknown>;
  for (const r of schema.required ?? []) if (a[r] === undefined || a[r] === null) return `missing required argument "${r}"`;
  if (schema.additionalProperties === false || schema.additionalProperties === undefined) {
    for (const k of Object.keys(a)) if (!(k in schema.properties)) return `unknown argument "${k}"`;
  }
  for (const [k, spec] of Object.entries(schema.properties)) {
    const v = a[k];
    if (v === undefined || v === null) continue;
    const err = check(spec, v, k);
    if (err) return err;
  }
  return null;
}

function check(spec: any, v: unknown, path: string): string | null {
  const t = spec.type;
  if (spec.enum && !spec.enum.includes(v)) return `"${path}" must be one of: ${spec.enum.join(", ")}`;
  if (t === "string") {
    if (typeof v !== "string") return `"${path}" must be a string`;
    if (spec.minLength != null && v.length < spec.minLength) return `"${path}" is too short`;
    if (spec.maxLength != null && v.length > spec.maxLength) return `"${path}" is too long (max ${spec.maxLength})`;
  } else if (t === "number" || t === "integer") {
    if (typeof v !== "number" || !Number.isFinite(v)) return `"${path}" must be a number`;
    if (t === "integer" && !Number.isInteger(v)) return `"${path}" must be an integer`;
    if (spec.minimum != null && v < spec.minimum) return `"${path}" must be at least ${spec.minimum}`;
    if (spec.maximum != null && v > spec.maximum) return `"${path}" must be at most ${spec.maximum}`;
  } else if (t === "boolean") {
    if (typeof v !== "boolean") return `"${path}" must be true or false`;
  } else if (t === "array") {
    if (!Array.isArray(v)) return `"${path}" must be a list`;
    if (spec.maxItems != null && v.length > spec.maxItems) return `"${path}" has too many items`;
    if (spec.items) for (const [i, x] of v.entries()) { const e = check(spec.items, x, `${path}[${i}]`); if (e) return e; }
  }
  return null;
}
