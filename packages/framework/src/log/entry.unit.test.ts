import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { createDeployment } from "../core/identity.js";
import { readFileSync } from "node:fs";
import { buildEntry, isLogEntry } from "./entry.js";

/** The contract schema, read from docs so drift between it and `isLogEntry` fails here. */
const schema = JSON.parse(readFileSync(new URL("../../../../docs/contracts/schemas/log-entry.schema.json", import.meta.url), "utf8")) as {
  type: string;
  required: string[];
  additionalProperties: boolean;
  properties: Record<string, { type?: string; enum?: string[]; format?: string }>;
};

/** Interprets exactly the keywords log-entry.schema.json uses (refuses any other). */
function schemaAccepts(value: unknown): boolean {
  const known = new Set(["$schema", "$id", "title", "description", "type", "required", "additionalProperties", "properties"]);
  for (const key of Object.keys(schema)) if (!known.has(key)) throw new Error(`schema keyword not interpreted: ${key}`);
  if (schema.type !== "object" || schema.additionalProperties !== false) throw new Error("schema shape changed");
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!schema.required.every((key) => key in record)) return false;
  for (const [key, v] of Object.entries(record)) {
    const property = schema.properties[key];
    if (property === undefined) return false;
    for (const keyword of Object.keys(property)) {
      if (!["type", "enum", "format", "description"].includes(keyword)) throw new Error(`property keyword not interpreted: ${keyword}`);
    }
    if (property.type !== undefined && property.type !== "string") throw new Error(`type not interpreted: ${property.type}`);
    if (property.type === "string" && typeof v !== "string") return false;
    if (property.enum !== undefined && !property.enum.includes(v as string)) return false;
    if (property.format !== undefined) {
      if (property.format !== "date-time") throw new Error(`format not interpreted: ${property.format}`);
      // RFC 3339 date-time.
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(v as string) || Number.isNaN(Date.parse(v as string))) return false;
    }
  }
  return true;
}

const deployment = createDeployment({ app: "notes", stage: "dev", target: "local" });
const fixed = () => new Date("2026-10-19T08:09:10.123Z");

describe("buildEntry", () => {
  it(tag("LOG-AC-002", "adds time (UTC), app, stage, target and the request ID"), () => {
    const entry = buildEntry({ deployment, requestId: "r-1", now: fixed }, "notes", "info", "hello");
    expect(entry).toEqual({
      time: "2026-10-19T08:09:10.123Z",
      app: "notes",
      stage: "dev",
      target: "local",
      component: "notes",
      severity: "info",
      message: "hello",
      requestId: "r-1",
    });
  });

  it("omits requestId outside a request", () => {
    const entry = buildEntry({ deployment, now: fixed }, "KV", "warn", "x");
    expect("requestId" in entry).toBe(false);
  });
});

describe("isLogEntry agrees with log-entry.schema.json", () => {
  const valid = buildEntry({ deployment, requestId: "r-1", now: fixed }, "notes", "info", "hello");
  const { requestId: _omit, ...withoutRequestId } = valid;
  const samples: Record<string, unknown> = {
    built: valid,
    "built outside a request": withoutRequestId,
    "missing message": { ...valid, message: undefined },
    "extra field": { ...valid, extra: 1 },
    "unknown severity": { ...valid, severity: "fatal" },
    "unknown target": { ...valid, target: "gcp" },
    "aws target": { ...valid, target: "aws" },
    "non-string component": { ...valid, component: 3 },
    "non-string requestId": { ...valid, requestId: 3 },
    "time not date-time": { ...valid, time: "yesterday" },
    "not an object": "entry",
    array: [valid],
    null: null,
  };
  for (const [name, sample] of Object.entries(samples)) {
    const value = sample !== null && typeof sample === "object" && !Array.isArray(sample) ? dropUndefined(sample) : sample;
    it(tag("LOG-AC-002", `same verdict as the schema: ${name}`), () => {
      expect(isLogEntry(value)).toBe(schemaAccepts(value));
    });
  }

  it(tag("LOG-AC-002", "built entries validate against the schema"), () => {
    expect(schemaAccepts(valid)).toBe(true);
    expect(schemaAccepts(withoutRequestId)).toBe(true);
  });
});

function dropUndefined(value: object): object {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}
