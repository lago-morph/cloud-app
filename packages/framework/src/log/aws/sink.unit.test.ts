/**
 * The AWS log sink (log.md §2 "AWS"): one SigV4-signed S3 `PutObject` per entry, under the
 * LOG-REQ-004 key, with the expected-owner header and the role's session token; the write is
 * tracked so the handler waits for it at most PAR-260; a denied or failed write is dropped and
 * the request still succeeds (LOG-AC-001). Every request goes to a fetch stub; a network guard
 * refuses any real `*.amazonaws.com` request.
 */
import { createHash, createHmac } from "node:crypto";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { createDeployment } from "../../core/identity.js";
import { installAwsNetworkGuard, type AwsNetworkGuard } from "../../provision/aws/aws-network-guard.test-support.js";
import type { LogEntry } from "../entry.js";
import { logObjectKey } from "../keys.js";
import { createLogWriter } from "../writer.js";
import { createPendingWrites, LOG_WRITE_WAIT_MS } from "./pending.js";
import { EXPECTED_OWNER_HEADER, logObjectUrl, s3LogSink, type S3LogBucket } from "./sink.js";

const ACCOUNT = "123456789012";
const BUCKET: S3LogBucket = {
  bucket: `prototype-logs-${ACCOUNT}`,
  accountId: ACCOUNT,
  region: "eu-west-1",
  credentials: { accessKeyId: "ASIAEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", sessionToken: "session-token-value" },
};
const NOW = new Date("2026-10-20T03:04:05.000Z");

const entry: LogEntry = {
  time: "2026-10-20T03:04:05.067Z",
  app: "notes",
  stage: "test-abc",
  target: "aws",
  component: "CORE",
  severity: "info",
  message: "hello",
  requestId: "r-1",
};

let guard: AwsNetworkGuard;
beforeAll(() => {
  guard = installAwsNetworkGuard();
});
afterAll(() => {
  guard.uninstall();
});
afterEach(() => {
  vi.useRealTimers();
});

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** A fetch stub that records each request and answers `status`. */
function stubFetch(status = 200): { fetch: (r: Request) => Promise<Response>; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: async (request) => {
      sent.push({ method: request.method, url: request.url, headers: Object.fromEntries(request.headers), body: await request.text() });
      const body = status === 403 ? "<Error><Code>AccessDenied</Code><Message>explicit deny</Message></Error>" : "";
      return new Response(body, { status });
    },
  };
}

function uriEncode(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** An independent SigV4 header-signature check (AWS "Create a signed request"), node:crypto only. */
function expectedHeaderSignature(sent: Sent, secret: string): string {
  const url = new URL(sent.url);
  const auth = sent.headers.authorization ?? "";
  const credential = /Credential=([^,]+)/.exec(auth)?.[1] ?? "";
  const signedHeaders = (/SignedHeaders=([^,]+)/.exec(auth)?.[1] ?? "").split(";");
  const [, date = "", region = "", service = ""] = credential.split("/");
  const canonicalHeaders = signedHeaders.map((h) => `${h}:${(h === "host" ? url.host : (sent.headers[h] ?? "")).trim()}`).join("\n") + "\n";
  const canonicalPath = decodeURIComponent(url.pathname).split("/").map(uriEncode).join("/");
  const canonical = ["PUT", canonicalPath, "", canonicalHeaders, signedHeaders.join(";"), sent.headers["x-amz-content-sha256"] ?? ""].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", sent.headers["x-amz-date"] ?? "", scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  let key: Buffer = createHmac("sha256", `AWS4${secret}`).update(date).digest();
  for (const part of [region, service, "aws4_request"]) key = createHmac("sha256", key).update(part).digest();
  return createHmac("sha256", key).update(toSign).digest("hex");
}

describe("s3LogSink", () => {
  it(tag("LOG-AC-004", "unit (AWS sink): one PutObject per entry, under the shared LOG-REQ-004 key, with the JSON entry as body"), async () => {
    const stub = stubFetch();
    const pending = createPendingWrites();
    s3LogSink({ bucket: BUCKET, pending, fetch: stub.fetch, now: () => NOW })(entry);
    await pending.settle();
    expect(stub.sent).toHaveLength(1);
    const [put] = stub.sent;
    expect(put!.method).toBe("PUT");
    expect(put!.url).toBe(`https://prototype-logs-${ACCOUNT}.s3.eu-west-1.amazonaws.com/${logObjectKey(entry)}`);
    expect(put!.url).toBe(`https://prototype-logs-${ACCOUNT}.s3.eu-west-1.amazonaws.com/notes/test-abc/2026/10/20/030405.067-info-r-1.json`);
    expect(put!.body).toBe(JSON.stringify(entry));
    expect(put!.headers["content-type"]).toBe("application/json");
  });

  it("an entry without a request ID gets the random final key part", async () => {
    const stub = stubFetch();
    const pending = createPendingWrites();
    const { requestId: _omitted, ...outside } = entry;
    s3LogSink({ bucket: BUCKET, pending, fetch: stub.fetch, random: () => "rand-0" })(outside);
    await pending.settle();
    expect(new URL(stub.sent[0]!.url).pathname).toBe("/notes/test-abc/2026/10/20/030405.067-info-rand-0.json");
  });

  it("sends x-amz-expected-bucket-owner with the account ID, and the role's session token, both signed", async () => {
    const stub = stubFetch();
    const pending = createPendingWrites();
    s3LogSink({ bucket: BUCKET, pending, fetch: stub.fetch, now: () => NOW })(entry);
    await pending.settle();
    const { headers } = stub.sent[0]!;
    expect(EXPECTED_OWNER_HEADER).toBe("x-amz-expected-bucket-owner");
    expect(headers[EXPECTED_OWNER_HEADER]).toBe(ACCOUNT);
    expect(headers["x-amz-security-token"]).toBe("session-token-value");
    expect(headers["x-amz-date"]).toBe("20261020T030405Z");
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=ASIAEXAMPLE\/20261020\/eu-west-1\/s3\/aws4_request, /);
    const signed = (/SignedHeaders=([^,]+)/.exec(headers.authorization!)?.[1] ?? "").split(";");
    expect(signed).toEqual(expect.arrayContaining(["host", "content-type", EXPECTED_OWNER_HEADER, "x-amz-content-sha256", "x-amz-date", "x-amz-security-token"]));
    expect(JSON.stringify(headers)).not.toContain(BUCKET.credentials.secretAccessKey);
  });

  it("the signature is the SigV4 signature S3 computes, over the body's SHA-256", async () => {
    const stub = stubFetch();
    const pending = createPendingWrites();
    s3LogSink({ bucket: BUCKET, pending, fetch: stub.fetch, now: () => NOW })(entry);
    await pending.settle();
    const sent = stub.sent[0]!;
    expect(sent.headers["x-amz-content-sha256"]).toBe(createHash("sha256").update(sent.body).digest("hex"));
    expect(/Signature=([0-9a-f]{64})$/.exec(sent.headers.authorization!)?.[1]).toBe(expectedHeaderSignature(sent, BUCKET.credentials.secretAccessKey));
  });

  it("encodes each key segment in the object URL", () => {
    expect(logObjectUrl(BUCKET, "a b/c+d.json")).toBe(`https://prototype-logs-${ACCOUNT}.s3.eu-west-1.amazonaws.com/a%20b/c%2Bd.json`);
  });

  it("returns at once and hands the write to the invocation's pending writes", () => {
    const pending = createPendingWrites();
    const result = s3LogSink({ bucket: BUCKET, pending, fetch: () => new Promise(() => {}) })(entry);
    expect(result).toBeUndefined();
    expect(pending.size).toBe(1);
  });

  it(tag("LOG-AC-001", "unit (AWS sink): a denied PutObject (403), a 5xx and a network error are each dropped; the tracked write settles"), async () => {
    for (const fetch of [stubFetch(403).fetch, stubFetch(503).fetch, () => Promise.reject(new TypeError("fetch failed"))]) {
      const pending = createPendingWrites();
      expect(() => s3LogSink({ bucket: BUCKET, pending, fetch })(entry)).not.toThrow();
      await expect(pending.settle()).resolves.toBeUndefined();
      expect(pending.size).toBe(0);
    }
  });

  it("sends each write once: aws4fetch's retries are not used", async () => {
    const stub = stubFetch(500);
    const pending = createPendingWrites();
    s3LogSink({ bucket: BUCKET, pending, fetch: stub.fetch })(entry);
    await pending.settle();
    expect(stub.sent).toHaveLength(1);
  });

  it("without complete log-bucket settings, prints the entry as a marked output line and sends nothing", () => {
    const lines: string[] = [];
    const pending = createPendingWrites();
    s3LogSink({ bucket: undefined, pending, print: (line) => void lines.push(line) })(entry);
    expect(lines).toEqual([`[prototype-framework:log] ${JSON.stringify(entry)}`]);
    expect(pending.size).toBe(0);
    expect(() =>
      s3LogSink({
        bucket: undefined,
        pending,
        print: () => {
          throw new Error("closed");
        },
      })(entry),
    ).not.toThrow();
  });
});

/**
 * The handler contract G-05 builds (log.md §2 "AWS"): one pending-writes tracker per
 * invocation, the request's writer over the S3 sink, and `await pending.settle()` before the
 * response is returned.
 */
function lambdaLikeApp(fetch: (r: Request) => Promise<Response>): Hono {
  const deployment = createDeployment({ app: "notes", stage: "test-abc", target: "aws" });
  const app = new Hono();
  app.get("/api/thing", (c) => {
    const pending = createPendingWrites();
    const log = createLogWriter({ deployment, requestId: "req-1" }, s3LogSink({ bucket: BUCKET, pending, fetch }));
    log.write("APP", "info", "first");
    log.write("APP", "error", "second");
    return pending.settle().then(() => c.json({ ok: true }));
  });
  return app;
}

describe("a request that writes log entries (LOG-AC-001, AWS logic)", () => {
  it(tag("LOG-AC-001", "unit (AWS): with PutObject denied (403 AccessDenied) the request still succeeds, after both writes were attempted"), async () => {
    const stub = stubFetch(403);
    const response = await lambdaLikeApp(stub.fetch).request("/api/thing");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(stub.sent.map((s) => new URL(s.url).pathname.split("-").slice(-3).join("-")).sort()).toEqual(["error-req-1.json", "info-req-1.json"]);
  });

  it(tag("LOG-AC-001", "unit (AWS): with writes that never complete, the response is delayed by no more than PAR-260"), async () => {
    vi.useFakeTimers();
    const app = lambdaLikeApp(() => new Promise(() => {}));
    const start = Date.now();
    let answeredAt: number | undefined;
    let status: number | undefined;
    void Promise.resolve(app.request("/api/thing")).then((r) => {
      answeredAt = Date.now();
      status = r.status;
    });
    await vi.advanceTimersByTimeAsync(LOG_WRITE_WAIT_MS - 1);
    expect(answeredAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(status).toBe(200);
    expect(answeredAt! - start).toBe(LOG_WRITE_WAIT_MS);
  });

  it("with writes that complete, the response waits for them and no longer", async () => {
    const releases: Array<() => void> = [];
    const app = lambdaLikeApp(() => new Promise<Response>((resolve) => releases.push(() => resolve(new Response("", { status: 200 })))));
    let answered = false;
    const response = Promise.resolve(app.request("/api/thing")).then((r) => {
      answered = true;
      return r;
    });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[0]!();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(answered).toBe(false);
    releases[1]!();
    expect((await response).status).toBe(200);
  });
});

describe("network guard: the AWS log sink reaches no real AWS endpoint", () => {
  it("the sink's default fetch is the global fetch, which the guard refuses for *.amazonaws.com; the write is dropped", async () => {
    const inner = installAwsNetworkGuard();
    try {
      const pending = createPendingWrites();
      s3LogSink({ bucket: BUCKET, pending })(entry);
      await pending.settle();
      expect(inner.attempts).toEqual([`prototype-logs-${ACCOUNT}.s3.eu-west-1.amazonaws.com`]);
    } finally {
      inner.uninstall();
    }
  });

  it("no other test in this file attempted an AWS request", () => {
    expect(guard.attempts).toEqual([]);
  });
});
