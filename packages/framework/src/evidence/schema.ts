/**
 * The evidence record schema (COMPL-REQ-003), embedded so the package needs no file from
 * `docs/`. A unit test keeps it identical to `docs/contracts/schemas/evidence.schema.json`.
 *
 * `validateEvidence` interprets the schema itself, for the JSON Schema keywords the contract
 * uses (type, required, additionalProperties, properties, items, enum, format date-time,
 * if/then). A keyword it does not know makes it throw, so a schema change cannot be ignored.
 */

export const EVIDENCE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "evidence.schema.json",
  title: "Verification evidence record",
  description:
    "One record per verification run, written by COMPL and the guided certification (SYS-REQ-028). Stored under validation/. Owner: COMPL. Behavior: docs/components/compliance.md.",
  type: "object",
  required: ["runId", "commit", "target", "command", "startedAt", "finishedAt", "exitStatus", "results", "versions"],
  additionalProperties: false,
  properties: {
    runId: { type: "string" },
    commit: { type: "string", description: "Source commit verified." },
    target: { enum: ["local", "cloudflare", "aws"] },
    stage: { type: "string" },
    command: { type: "string" },
    startedAt: { type: "string", format: "date-time" },
    finishedAt: { type: "string", format: "date-time" },
    exitStatus: { type: "integer" },
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "status"],
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "Acceptance criterion or scenario ID, e.g. KV-AC-003, E2E-004." },
          status: { enum: ["passed", "failed", "blocked", "not-run"], description: "blocked: a prerequisite was missing. not-run: not executed." },
          detail: {
            type: "string",
            description: "Required for blocked and not-run: the reason. For a failure that came from an HTTP response: the observed status, error code, and requestId.",
          },
        },
        if: { properties: { status: { enum: ["blocked", "not-run"] } }, required: ["status"] },
        then: { required: ["detail"] },
      },
    },
    versions: { type: "object", additionalProperties: { type: "string" }, description: "Exact framework and dependency versions; never secrets." },
    leftovers: { type: "array", items: { type: "string" }, description: "Cloud resources the run could not remove." },
  },
} as const;

type Schema = { readonly [keyword: string]: unknown };

const ANNOTATIONS = new Set(["$schema", "$id", "title", "description"]);
const KNOWN = new Set([...ANNOTATIONS, "type", "required", "additionalProperties", "properties", "items", "enum", "format", "if", "then"]);
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function check(schema: Schema, value: unknown, path: string, errors: string[]): void {
  for (const keyword of Object.keys(schema)) {
    if (!KNOWN.has(keyword)) throw new Error(`evidence schema: keyword ${keyword} is not supported by validateEvidence`);
  }
  const at = path === "" ? "/" : path;
  const before = errors.length;
  switch (schema.type) {
    case undefined:
      break;
    case "object":
      if (!isObject(value)) errors.push(`${at}: must be an object`);
      break;
    case "array":
      if (!Array.isArray(value)) errors.push(`${at}: must be an array`);
      break;
    case "string":
      if (typeof value !== "string") errors.push(`${at}: must be a string`);
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) errors.push(`${at}: must be an integer`);
      break;
    default:
      throw new Error(`evidence schema: type ${String(schema.type)} is not supported by validateEvidence`);
  }
  if (errors.length > before) return;

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${at}: must be one of ${schema.enum.join(", ")}`);
  if (schema.format !== undefined) {
    if (schema.format !== "date-time") throw new Error(`evidence schema: format ${String(schema.format)} is not supported`);
    if (typeof value === "string" && (!DATE_TIME.test(value) || Number.isNaN(Date.parse(value)))) errors.push(`${at}: must be a date-time`);
  }

  if (isObject(value)) {
    for (const name of (schema.required as readonly string[] | undefined) ?? []) {
      if (!(name in value)) errors.push(`${at}: missing required property ${name}`);
    }
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const [name, child] of Object.entries(value)) {
      const childSchema = properties[name];
      if (childSchema !== undefined) check(childSchema, child, `${path}/${name}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${at}: unknown property ${name}`);
      else if (isObject(schema.additionalProperties)) check(schema.additionalProperties, child, `${path}/${name}`, errors);
    }
    if (isObject(schema.if) && isObject(schema.then)) {
      const probe: string[] = [];
      check(schema.if, value, path, probe);
      if (probe.length === 0) check(schema.then, value, path, errors);
    }
  }
  if (Array.isArray(value) && isObject(schema.items)) {
    value.forEach((item, index) => check(schema.items as Schema, item, `${path}/${String(index)}`, errors));
  }
}

/** Returns the schema violations of `value` as `<JSON pointer>: <problem>` lines; empty when valid. */
export function validateEvidence(value: unknown): string[] {
  const errors: string[] = [];
  check(EVIDENCE_SCHEMA, value, "", errors);
  return errors;
}
