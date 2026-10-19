import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { createErrorHandler } from "./errors.js";
import { jsonBody, queryParams, z } from "./public.js";

/** A plain Hono app with HTTP's error handler and a request ID, recording whether handlers ran. */
function app() {
  const ran: string[] = [];
  const hono = new Hono();
  hono.onError(createErrorHandler());
  hono.use(async (c, next) => {
    c.set("requestId" as never, "req-1" as never);
    await next();
  });
  return { hono, ran };
}

const post = (body: BodyInit, headers: Record<string, string> = { "Content-Type": "application/json" }) => ({
  method: "POST",
  headers,
  body,
});

describe("jsonBody", () => {
  const schema = z.object({ title: z.string().min(1), done: z.boolean().default(false) });

  it("passes the schema's output to the handler through c.req.valid('json')", async () => {
    const { hono } = app();
    hono.post("/notes", jsonBody(schema), (c) => c.json(c.req.valid("json")));
    const res = await hono.request("/notes", post(JSON.stringify({ title: "a" })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: "a", done: false });
  });

  it(tag("HTTP-AC-003", "unit part: a schema-invalid body is rejected with 400 HTTP.INVALID_INPUT before the handler runs"), async () => {
    const { hono, ran } = app();
    hono.post("/notes", jsonBody(schema), (c) => {
      ran.push("handler");
      return c.json({});
    });
    for (const body of [JSON.stringify({ title: "" }), JSON.stringify({ title: 3 }), "{not json", ""]) {
      const res = await hono.request("/notes", post(body));
      expect(res.status, body).toBe(400);
      const json = (await res.json()) as { error: { code: string; message: string; requestId: string } };
      expect(json.error.code).toBe("HTTP.INVALID_INPUT");
      expect(json.error.requestId).toBe("req-1");
    }
    expect(ran).toEqual([]);
  });

  const LIMIT = 1_000_000; // PAR-200
  /** A JSON string literal of exactly `bytes` bytes. */
  const jsonOfSize = (bytes: number) => `"${"a".repeat(bytes - 2)}"`;
  /** The same bytes as a stream with no Content-Length, in 64 KiB chunks. */
  const streamOf = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(bytes.subarray(offset, offset + 65536));
        offset += 65536;
      },
    });
  };

  it(tag("HTTP-AC-003", "unit part: a body of PAR-200 + 1 bytes is rejected with 413 before the handler runs, by Content-Length and by streamed size"), async () => {
    const { hono, ran } = app();
    hono.post("/big", jsonBody(z.string()), (c) => {
      ran.push("handler");
      return c.json({});
    });
    const tooBig = jsonOfSize(LIMIT + 1);
    const byLength = await hono.request("/big", post(tooBig));
    const streamed = await hono.request(
      new Request("http://localhost/big", { ...post(streamOf(tooBig)), duplex: "half" } as RequestInit),
    );
    for (const res of [byLength, streamed]) {
      expect(res.status).toBe(413);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("HTTP.PAYLOAD_TOO_LARGE");
    }
    expect(ran).toEqual([]);
  });

  it("leaves the request's other parts alone: query and headers still readable after validation", async () => {
    const { hono } = app();
    hono.post("/q", jsonBody(z.object({ a: z.number() })), (c) => c.json({ q: c.req.query("x"), h: c.req.header("x-h") }));
    const res = await hono.request("/q?x=1", post(JSON.stringify({ a: 1 }), { "Content-Type": "application/json", "X-H": "h" }));
    expect(await res.json()).toEqual({ q: "1", h: "h" });
  });

  it("accepts a body of exactly PAR-200 bytes, by Content-Length and streamed", async () => {
    const { hono } = app();
    hono.post("/big", jsonBody(z.string()), (c) => c.json(c.req.valid("json").length));
    const exact = jsonOfSize(LIMIT);
    expect(await (await hono.request("/big", post(exact))).json()).toBe(LIMIT - 2);
    const streamed = await hono.request(
      new Request("http://localhost/big", { ...post(streamOf(exact)), duplex: "half" } as RequestInit),
    );
    expect(await streamed.json()).toBe(LIMIT - 2);
  });
});

describe("queryParams", () => {
  const schema = z.object({ page: z.coerce.number().int().min(1).default(1), q: z.string().optional() });

  it("passes the schema's output to the handler through c.req.valid('query')", async () => {
    const { hono } = app();
    hono.get("/search", queryParams(schema), (c) => c.json(c.req.valid("query")));
    expect(await (await hono.request("/search?page=3&q=tea")).json()).toEqual({ page: 3, q: "tea" });
    expect(await (await hono.request("/search")).json()).toEqual({ page: 1 });
  });

  it("rejects invalid query parameters with 400 HTTP.INVALID_INPUT before the handler runs", async () => {
    const { hono, ran } = app();
    hono.get("/search", queryParams(schema), (c) => {
      ran.push("handler");
      return c.json({});
    });
    const res = await hono.request("/search?page=zero");
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe("HTTP.INVALID_INPUT");
    expect(json.error.message).toContain("query.page");
    expect(ran).toEqual([]);
  });
});
