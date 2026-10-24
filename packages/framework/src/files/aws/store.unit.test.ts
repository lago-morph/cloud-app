import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FrameworkError } from "../../core/errors.js";
import { installAwsNetworkGuard, type AwsNetworkGuard } from "../../provision/aws/aws-network-guard.test-support.js";
import { createFilesService, type TicketIssuer } from "../service.js";
import type { FilesService } from "../public.js";
import { createS3Fake, type S3Fake } from "./s3-fake.test-support.js";
import { createS3FilesStore, type S3StoreOptions } from "./store.js";

/** Dummy identifiers and credentials, generated per run; never real ones. */
const location = { bucket: "app-test-x-files", region: "us-east-1", accountId: "123456789012" };
const credentials = { accessKeyId: `ASIA${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`, secretAccessKey: crypto.randomUUID(), sessionToken: crypto.randomUUID() };
const NOW = Date.parse("2026-10-24T10:00:00.000Z");

let guard: AwsNetworkGuard;
beforeAll(() => {
  guard = installAwsNetworkGuard();
});
afterAll(() => {
  expect(guard.attempts).toEqual([]);
  guard.uninstall();
});

const noTickets: TicketIssuer = {
  upload: () => Promise.reject(new Error("unexpected ticket")),
  download: () => Promise.reject(new Error("unexpected ticket")),
};

function setup(storeOverrides: Partial<S3StoreOptions> = {}, fakeOptions: { maxKeysCap?: number } = {}): { fake: S3Fake; files: FilesService } {
  const fake = createS3Fake({ location, credentials, now: () => NOW, ...fakeOptions });
  const store = createS3FilesStore({ location, credentials: () => credentials, fetch: fake.fetch, now: () => NOW, ...storeOverrides });
  return { fake, files: createFilesService({ store, tickets: noTickets }) };
}

async function text(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

async function codeOf(run: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await run();
  } catch (thrown) {
    if (thrown instanceof FrameworkError) return { code: thrown.code, message: thrown.message };
    throw thrown;
  }
  throw new Error("expected a FrameworkError");
}

describe("[FILES-AC-001 pre-check] the AWS store over the S3 fake: put, get, head, delete (FILES-REQ-001)", () => {
  it("round-trips bytes and content type byte-exact; every request is SigV4-signed with the session token and the expected owner", async () => {
    const { fake, files } = setup();
    const bytes = new Uint8Array([0, 1, 2, 254, 255, 10, 13]);
    await files.put("doc/a.bin", bytes, { contentType: "application/x-thing" });
    const got = await files.get("doc/a.bin");
    expect(got).toMatchObject({ name: "doc/a.bin", size: 7, contentType: "application/x-thing" });
    expect(Array.from(new Uint8Array(await new Response(got?.body).arrayBuffer()))).toEqual(Array.from(bytes));
    expect(await files.head("doc/a.bin")).toEqual({ name: "doc/a.bin", size: 7, contentType: "application/x-thing" });
    expect(fake.requests.length).toBeGreaterThanOrEqual(3);
    for (const request of fake.requests) {
      expect(new URL(request.url).host).toBe("app-test-x-files.s3.us-east-1.amazonaws.com");
      expect(request.headers["authorization"]).toMatch(new RegExp(`^AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/20261024/us-east-1/s3/aws4_request, SignedHeaders=`));
      expect(request.headers["x-amz-security-token"]).toBe(credentials.sessionToken);
      expect(request.headers["x-amz-expected-bucket-owner"]).toBe("123456789012");
    }
    // The PUT signs its payload hash and content type.
    const put = fake.requests[0];
    expect(put?.headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
    expect(put?.headers["authorization"]).toContain("content-type;");
  });

  it("defaults the content type, overwrites, returns null for a missing get/head, and a repeated delete succeeds", async () => {
    const { files } = setup();
    await files.put("x", new TextEncoder().encode("one"));
    expect((await files.head("x"))?.contentType).toBe("application/octet-stream");
    await files.put("x", new TextEncoder().encode("second"), { contentType: "text/plain" });
    const got = await files.get("x");
    expect(got?.size).toBe(6);
    expect(await text(got?.body ?? new ReadableStream())).toBe("second");
    expect(await files.get("missing")).toBeNull();
    expect(await files.head("missing")).toBeNull();
    await files.delete("x");
    await files.delete("x");
    expect(await files.get("x")).toBeNull();
  });

  it("buffers a stream body for the single PUT", async () => {
    const { fake } = setup();
    const store = createS3FilesStore({ location, credentials: () => credentials, fetch: fake.fetch, now: () => NOW });
    await store.put("s", new Response("streamed bytes").body ?? new ReadableStream(), { httpMetadata: { contentType: "text/plain" } });
    expect(new TextDecoder().decode(fake.objects.get("s")?.bytes)).toBe("streamed bytes");
  });
});

describe("[FILES-AC-002 pre-check] names on S3 keys (FILES-REQ-002, DEC-0328)", () => {
  const names = [
    "with space.txt",
    " leading and trailing ",
    "100%.bin",
    "%2F%00%",
    "a+b=c&d?e#f",
    "it's (1)*!.txt",
    "a/b/c.txt",
    "/leading-slash",
    "trailing/",
    "a//b",
    "../../etc/passwd",
    "a/../b",
    "./x",
    "naïve résumé.pdf",
    "文件/照片.jpg",
    "emoji-😀🎉",
    "\u{FFFF}\u0080",
    "é".repeat(512),
  ];

  it("each name is its own S3 key unchanged (no U+0001 ending on AWS, DEC-0430) and round-trips through put/get/head/list", async () => {
    const { fake, files } = setup();
    for (const [i, name] of names.entries()) await files.put(name, new TextEncoder().encode(`content-${i}`));
    expect([...fake.objects.keys()].sort()).toEqual([...names].sort());
    for (const [i, name] of names.entries()) {
      const got = await files.get(name);
      expect(got?.name).toBe(name);
      expect(await text(got?.body ?? new ReadableStream())).toBe(`content-${i}`);
      expect((await files.head(name))?.name).toBe(name);
    }
    const listed = await files.list("", { limit: 1000 });
    expect(new Set(listed.items.map((i) => i.name))).toEqual(new Set(names));
  });

  it("a name with a dot segment is sent with every / as %2F, so no URL parser collapses it", async () => {
    const { fake, files } = setup();
    await files.put("x/../y", new Uint8Array([1]));
    expect(new URL(fake.requests[0]?.url ?? "").pathname).toBe("/x%2F..%2Fy");
    expect([...fake.objects.keys()]).toEqual(["x/../y"]);
  });

  it.each([".", ".."])("the name %j cannot be an S3 URL path, so every operation on it is FILES.INVALID_NAME (target difference, DEC-0328)", async (name) => {
    const { fake, files } = setup();
    for (const run of [() => files.put(name, new Uint8Array([1])), () => files.get(name), () => files.head(name), () => files.delete(name)]) {
      expect((await codeOf(run)).code).toBe("FILES.INVALID_NAME");
    }
    expect(fake.requests).toEqual([]);
  });
});

describe("[FILES-AC-001 pre-check] list order and pagination over ListObjectsV2 (FILES-REQ-001, DEC-0162)", () => {
  // Code point order. A proper prefix comes first (S3 lists in UTF-8 byte order), and U+FFFD
  // sorts before U+1F600 although its UTF-16 code unit is larger.
  const ordered = ["p/Z", "p/a", "p/a b", "p/a+", "p/a/b", "p/aa", "p/ä", "p/€", "p/�", "p/😀"];

  it("lists in code point order, with exact names, content types and sizes", async () => {
    const { files } = setup();
    for (const name of [...ordered].reverse()) await files.put(name, new TextEncoder().encode(name), { contentType: `text/x-${ordered.indexOf(name)}` });
    await files.put("q/other", new Uint8Array([1]));
    const page = await files.list("p/");
    expect(page.items.map((i) => i.name)).toEqual(ordered);
    expect(page.items.map((i) => i.contentType)).toEqual(ordered.map((_, i) => `text/x-${i}`));
    expect(page.items.map((i) => i.size)).toEqual(ordered.map((n) => new TextEncoder().encode(n).byteLength));
    expect(page.nextCursor).toBeNull();
  });

  it.each([1, 2, 3, 4, 10])("pages of limit 3 over S3 pages of at most %i keys return each name once, in order", async (cap) => {
    const { fake, files } = setup({}, { maxKeysCap: cap });
    for (const name of ordered) await files.put(name, new Uint8Array([0]));
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 20; pages++) {
      const page = await files.list("p/", { limit: 3, ...(cursor === undefined ? {} : { cursor }) });
      expect(page.items.length).toBe(Math.min(3, ordered.length - seen.length));
      seen.push(...page.items.map((i) => i.name));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(ordered);
    const listings = fake.requests.filter((r) => new URL(r.url).searchParams.get("list-type") === "2");
    for (const listing of listings) expect(new URL(listing.url).searchParams.get("encoding-type")).toBe("url");
    // Paging continues with S3's start-after from the last name returned.
    expect(listings.some((l) => new URL(l.url).searchParams.get("start-after") === "p/a b")).toBe(true);
  });

  it("an exactly full last page has a null cursor; the prefix is literal", async () => {
    const { files } = setup();
    for (const name of ["%/1", "%/2", "%/3", "%x"]) await files.put(name, new Uint8Array([0]));
    const page = await files.list("%/", { limit: 3 });
    expect(page.items.map((i) => i.name)).toEqual(["%/1", "%/2", "%/3"]);
    expect(page.nextCursor).toBeNull();
  });

  it("an object deleted between the listing and its HEAD is left out, and a page of only such objects lists on", async () => {
    const { fake, files } = setup({}, { maxKeysCap: 2 });
    for (const name of ["d/1", "d/2", "d/3", "d/4"]) await files.put(name, new Uint8Array([0]));
    fake.beforeHead = (key) => {
      if (key === "d/1" || key === "d/2") fake.objects.delete(key);
    };
    const page = await files.list("d/", { limit: 10 });
    expect(page.items.map((i) => i.name)).toEqual(["d/3", "d/4"]);
  });

  it("a bad cursor is FILES.INVALID_CURSOR before any S3 call", async () => {
    const { fake, files } = setup();
    expect((await codeOf(() => files.list("p/", { cursor: "%%%" }))).code).toBe("FILES.INVALID_CURSOR");
    expect(fake.requests).toEqual([]);
  });
});

describe("[FILES-AC-006 pre-check] S3 failures become FILES.UNAVAILABLE without storage's body (FILES-REQ-006, DEC-0164)", () => {
  it.each([
    ["503 SlowDown", () => new Response("<Error><Code>SlowDown</Code><Message>secret detail</Message></Error>", { status: 503 }), "HTTP 503 (SlowDown)"],
    ["500 without a body", () => new Response(null, { status: 500 }), "HTTP 500"],
    ["403 AccessDenied", () => new Response("<Error><Code>AccessDenied</Code><Message>secret detail</Message></Error>", { status: 403 }), "HTTP 403 (AccessDenied)"],
    ["404 NoSuchBucket", () => new Response("<Error><Code>NoSuchBucket</Code><Message>secret detail</Message></Error>", { status: 404 }), "HTTP 404 (NoSuchBucket)"],
  ])("%s on get, put, delete and list", async (_label, answer, named) => {
    const { fake, files } = setup();
    const runs = [() => files.get("x"), () => files.put("x", new Uint8Array([1])), () => files.delete("x"), () => files.list("")];
    for (const run of runs) {
      fake.failNext(answer());
      const error = await codeOf(run);
      expect(error.code).toBe("FILES.UNAVAILABLE");
      expect(error.message).toContain(named);
      expect(error.message).not.toContain("secret detail");
    }
  });

  it("a HEAD answered other than 200 or 404 is FILES.UNAVAILABLE, and so is createUploadTicket's reachability check", async () => {
    const { fake, files } = setup();
    fake.failNext(new Response(null, { status: 403 }));
    expect(await codeOf(() => files.head("x"))).toMatchObject({ code: "FILES.UNAVAILABLE" });
    fake.failNext(new Response(null, { status: 500 }));
    expect(await codeOf(() => files.createUploadTicket("x"))).toMatchObject({ code: "FILES.UNAVAILABLE" });
  });

  it("an unreachable endpoint (fetch rejects) is FILES.UNAVAILABLE naming the cause", async () => {
    const { fake, files } = setup();
    fake.failNext(new TypeError("fetch failed"));
    expect(await codeOf(() => files.get("x"))).toEqual({ code: "FILES.UNAVAILABLE", message: "file storage could not be used (get): TypeError: fetch failed" });
  });

  it("a listing body that is not a ListBucketResult is FILES.UNAVAILABLE", async () => {
    const { fake, files } = setup();
    fake.failNext(new Response("<html>proxy</html>", { status: 200 }));
    expect(await codeOf(() => files.list(""))).toMatchObject({ code: "FILES.UNAVAILABLE" });
  });

  it("S3's own refusals reach the caller as FILES.UNAVAILABLE: wrong secret, missing session token, another account, clock skew", async () => {
    const cases: [Partial<S3StoreOptions>, string][] = [
      [{ credentials: () => ({ ...credentials, secretAccessKey: "wrong" }) }, "SignatureDoesNotMatch"],
      [{ credentials: () => ({ accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey }) }, "InvalidToken"],
      [{ location: { ...location, accountId: "210987654321" } }, "AccessDenied"],
      [{ now: () => NOW + 16 * 60 * 1000 }, "RequestTimeTooSkewed"],
    ];
    for (const [overrides, code] of cases) {
      const { files } = setup(overrides);
      const error = await codeOf(() => files.get("x"));
      expect(error.code).toBe("FILES.UNAVAILABLE");
      expect(error.message).toContain(`(${code})`);
    }
  });

  it("a body changed after signing fails S3's payload check (the PUT's SHA-256 is signed)", async () => {
    const fake = createS3Fake({ location, credentials, now: () => NOW });
    const tamper = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return fake.fetch(new Request(request, { body: new TextEncoder().encode("other"), method: request.method, headers: request.headers }));
    }) as typeof fetch;
    const files = createFilesService({ store: createS3FilesStore({ location, credentials: () => credentials, fetch: tamper, now: () => NOW }), tickets: noTickets });
    expect((await codeOf(() => files.put("x", new TextEncoder().encode("bytes")))).message).toContain("XAmzContentSHA256Mismatch");
    expect(fake.objects.size).toBe(0);
  });

  it("a bad bucket location is CORE.MISCONFIGURED when the store is created", () => {
    for (const bad of [{ bucket: "has.dots" }, { bucket: "UPPER" }, { region: "nowhere" }, { accountId: "12" }]) {
      expect(() => createS3FilesStore({ location: { ...location, ...bad }, credentials: () => credentials })).toThrow(expect.objectContaining({ code: "CORE.MISCONFIGURED" }));
    }
  });
});

describe("no unit test reaches AWS (plan-aws.md §3 shared rules)", () => {
  it("a store left on the global fetch is refused by the guard before any socket opens, and fails as FILES.UNAVAILABLE", async () => {
    const files = createFilesService({ store: createS3FilesStore({ location, credentials: () => credentials }), tickets: noTickets });
    const error = await codeOf(() => files.head("x"));
    expect(error.code).toBe("FILES.UNAVAILABLE");
    expect(error.message).toContain("blocked: a unit test tried to reach AWS");
    expect(guard.attempts).toEqual(["app-test-x-files.s3.us-east-1.amazonaws.com"]);
    guard.attempts.length = 0;
  });
});
