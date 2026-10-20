/**
 * HTTP-AC-003: a body of PAR-200 + 1 bytes is rejected with 413 before the handler runs; a
 * schema-invalid body is rejected with 400 HTTP.INVALID_INPUT (docs/components/http.md §4).
 *
 * "Before the handler runs" is observed two ways: the echo route's handler answers 200 for a body
 * of exactly PAR-200 bytes, so a 413 for one byte more is the framework's; and the KV write route
 * (ROUTES.md "KV") with an oversized or invalid body neither answers the handler's own KV code
 * (`KV.VALUE_TOO_LARGE`) nor stores the value.
 */
import { describe, expect, it } from "vitest";
import { client, tag } from "../../harness/index.js";
import { errorResponseViolations, maxJsonBodyBytes, uniqueValue } from "../core/support/repo.js";

/** A JSON object `{ "<field>": "aaa…" }` (plus `extra` members first) of exactly `bytes` UTF-8 bytes. */
function jsonOfSize(bytes: number, field: string, extra: Record<string, string> = {}): string {
  const head = `{${Object.entries(extra).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)},`).join("")}${JSON.stringify(field)}:"`;
  const tail = '"}';
  const body = `${head}${"a".repeat(bytes - head.length - tail.length)}${tail}`;
  if (Buffer.byteLength(body, "utf8") !== bytes) throw new Error("jsonOfSize: wrong size");
  return body;
}

describe("HTTP: validated input", () => {
  it(tag("HTTP-AC-003", "a JSON body of PAR-200 + 1 bytes is rejected with 413 HTTP.PAYLOAD_TOO_LARGE before the handler runs; PAR-200 bytes reach it"), async () => {
    const limit = maxJsonBodyBytes();
    const c = client();
    const atLimit = c.expectStatus(await c.request("POST", "/api/ref/echo", { body: jsonOfSize(limit, "text"), headers: { "content-type": "application/json" } }), 200);
    expect(atLimit.json<{ length: number }>().length).toBe(limit - '{"text":""}'.length);

    const over = c.expectError(await c.request("POST", "/api/ref/echo", { body: jsonOfSize(limit + 1, "text"), headers: { "content-type": "application/json" } }), 413, "HTTP.PAYLOAD_TOO_LARGE");
    expect(errorResponseViolations(over.json())).toEqual([]);

    // A handler with a side effect: had it run, it would answer its own KV code and store the value.
    const user = await c.as("user", { id: "c-t1-http-ac-003" });
    const key = `ref:c-t1-${uniqueValue("big")}`;
    const tooBig = await user.request("PUT", "/api/kv/value", { body: jsonOfSize(limit + 1, "value", { key }), headers: { "content-type": "application/json" } });
    user.expectError(tooBig, 413, "HTTP.PAYLOAD_TOO_LARGE");
    const stored = user.expectStatus(await user.get(`/api/kv/value?key=${encodeURIComponent(key)}`), 200).json<{ value: unknown }>();
    expect(stored.value, "the KV handler did not run for the oversized body").toBeNull();
  });

  it(tag("HTTP-AC-003", "a schema-invalid JSON body, a non-JSON body and an invalid query are rejected with 400 HTTP.INVALID_INPUT before the handler runs"), async () => {
    const c = client();
    for (const body of ['{"text":42}', "{}", '{"text":["a"]}', "not json at all", '{"text":"unterminated']) {
      const r = c.expectError(await c.request("POST", "/api/ref/echo", { body, headers: { "content-type": "application/json" } }), 400, "HTTP.INVALID_INPUT");
      expect(errorResponseViolations(r.json()), body).toEqual([]);
    }
    c.expectError(await c.get("/api/ref/echo"), 400, "HTTP.INVALID_INPUT");
    c.expectError(await c.get("/api/ref/echo?text="), 400, "HTTP.INVALID_INPUT");
    expect(c.expectStatus(await c.get("/api/ref/echo?text=ok"), 200).json()).toEqual({ text: "ok" });

    // A handler with a side effect: an invalid body stores nothing.
    const user = await c.as("user", { id: "c-t1-http-ac-003" });
    const key = `ref:c-t1-${uniqueValue("invalid")}`;
    user.expectError(await user.request("PUT", "/api/kv/value", { json: { key, value: 12345 } }), 400, "HTTP.INVALID_INPUT");
    const stored = user.expectStatus(await user.get(`/api/kv/value?key=${encodeURIComponent(key)}`), 200).json<{ value: unknown }>();
    expect(stored.value, "the KV handler did not run for the invalid body").toBeNull();
  });
});
