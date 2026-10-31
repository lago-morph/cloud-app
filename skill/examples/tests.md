# Example: app tests and the smoke test

Every file below is copied unchanged from the framework's app template (`apps/template`) or its compliance reference app (`apps/reference`). The framework's CI type-checks and tests those apps (`npm run verify` runs each app's `verify`), so this code compiles and passes as shown. Do not copy code from any other app.

What it shows:

- `tests/app.test.ts`: `createTestApp` per test with `dispose()` afterwards; `mockUsers` with `as()` and the `user` option; `config` and `secrets` options; asserting status codes, error codes and `logs()`; an in-process upload sent with the ticket's wire form, to test the finalize route (the form is the same on every target; only `url` differs: here a path on the app, sent with `t.request`; on a cloud an absolute storage URL, which tests send with plain `fetch`, never a test helper, see "The smoke test" in [testing.md](../reference/testing.md)) (the HMAC tests are in [secrets.md](secrets.md)).
- `tests/smoke/smoke.test.ts`: one file that runs in-process under `verify` and against a deployed test stage under `smoke` (`connectTestStage()`).
- From the reference app, `tests/support.ts`: a shared `open()` helper that disposes test apps after each test.
- `tests/e2e/`: the e2e layer, against a local `dev` server that the template's `playwright.config.ts` has Playwright start and stop. `api/notes.spec.ts` drives one flow through the HTTP API (project `e2e-api`, no browser, run by `verify`) with its edge cases listed first; `ui/account.spec.ts` is the one browser test, of what only a page shows (project `e2e-ui`) ([e2e.md](../reference/testing/e2e.md)).

## `apps/template/tests/app.test.ts`

<!-- example-source: apps/template/tests/app.test.ts -->
```ts
import { createTestApp, mockUsers, type TestApp } from "@lago-morph/prototype-framework/testing";
import { afterEach, describe, expect, it } from "vitest";
import app from "../src/app";
import type { FileList, Greeting, NoteList, SecretCheck, Status } from "../src/shared/types";

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

let opened: TestApp[] = [];
async function open(options?: Parameters<typeof createTestApp>[1]): Promise<TestApp> {
  const t = await createTestApp(app, options);
  opened.push(t);
  return t;
}

afterEach(async () => {
  await Promise.all(opened.map((t) => t.dispose()));
  opened = [];
});

describe("configuration", () => {
  it("serves the default greeting", async () => {
    const t = await open();
    const body: Greeting = await (await t.request("/api/hello")).json();
    expect(body).toEqual({ greeting: "Hello" });
  });

  it("serves the greeting configured for the stage", async () => {
    const t = await open({ config: { greeting: "Hi there" } });
    const body: Greeting = await (await t.request("/api/hello")).json();
    expect(body).toEqual({ greeting: "Hi there" });
  });
});

describe("notes (SQL, log)", () => {
  it("refuses anonymous requests", async () => {
    const t = await open();
    const res = await t.request("/api/notes");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "AUTH.UNAUTHENTICATED" } });
  });

  it("lists only the user's own notes, newest first, and logs each creation", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const bob = t.as(mockUsers.user("bob"));
    expect((await alice.request("/api/notes", json("POST", { text: "first" }))).status).toBe(201);
    expect((await alice.request("/api/notes", json("POST", { text: "second" }))).status).toBe(201);
    expect((await bob.request("/api/notes", json("POST", { text: "bob's" }))).status).toBe(201);

    const body: NoteList = await (await alice.request("/api/notes")).json();
    expect(body.notes.map((n) => n.text)).toEqual(["second", "first"]);
    expect(t.logs().filter((e) => e.component === "notes" && e.severity === "info")).toHaveLength(3);
  });

  it("rejects an empty note", async () => {
    const t = await open({ user: mockUsers.user() });
    const res = await t.request("/api/notes", json("POST", { text: "  " }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "HTTP.INVALID_INPUT" } });
  });
});

describe("status (KV)", () => {
  it("is null until set, then reads back per user", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const before: Status = await (await alice.request("/api/status")).json();
    expect(before).toEqual({ status: null });
    expect((await alice.request("/api/status", json("PUT", { status: "busy" }))).status).toBe(200);
    const after: Status = await (await alice.request("/api/status")).json();
    expect(after).toEqual({ status: "busy" });
    const bob: Status = await (await t.as(mockUsers.user("bob")).request("/api/status")).json();
    expect(bob).toEqual({ status: null });
  });
});

/** The in-process upload ticket's wire form (files.md §2), so the test can send what `uploadFile` sends. */
interface WireUploadTicket {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
}

async function upload(t: TestApp, contentType: string, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const res = await t.request("/api/files/upload-ticket", json("POST", { contentType }));
  expect(res.status).toBe(200);
  const { id, ticket }: { id: string; ticket: WireUploadTicket } = await res.json();
  const put = await t.request(ticket.url, { method: ticket.method, headers: ticket.headers, body: bytes });
  expect(put.status).toBeLessThan(300);
  return id;
}

describe("files", () => {
  it("lists an upload only after finalize, and only to its owner", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const bob = t.as(mockUsers.user("bob"));
    const id = await upload(alice, "text/plain", new TextEncoder().encode("hello"));
    const before: FileList = await (await alice.request("/api/files")).json();
    expect(before).toEqual({ files: [] });

    const res = await alice.request("/api/files/finalize", json("POST", { id, name: "a.txt" }));
    expect(res.status).toBe(201);
    const after: FileList = await (await alice.request("/api/files")).json();
    expect(after).toEqual({ files: [{ id, name: "a.txt", size: 5, contentType: "text/plain" }] });

    const bobs: FileList = await (await bob.request("/api/files")).json();
    expect(bobs).toEqual({ files: [] });
    expect((await bob.request("/api/files/finalize", json("POST", { id, name: "a.txt" }))).status).toBe(404);
    const theirs = await bob.request("/api/files/download-ticket", json("POST", { id }));
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toMatchObject({ error: { code: "HTTP.NOT_FOUND" } });
    const mine = await alice.request("/api/files/download-ticket", json("POST", { id }));
    expect(mine.status).toBe(200);
    expect(await mine.json()).toHaveProperty("ticket");
  });

  it("deletes an upload of a type it does not accept", async () => {
    const t = await open({ user: mockUsers.user() });
    const id = await upload(t, "application/zip", new Uint8Array(4));
    const res = await t.request("/api/files/finalize", json("POST", { id, name: "x" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "HTTP.CONFLICT" } });
    // The upload is gone, so a second finalize finds nothing.
    expect((await t.request("/api/files/finalize", json("POST", { id, name: "x" }))).status).toBe(404);
    const list: FileList = await (await t.request("/api/files")).json();
    expect(list).toEqual({ files: [] });
  });

  it("sets no size cap of its own: a file over 10 MiB is accepted", async () => {
    const t = await open({ user: mockUsers.user() });
    const id = await upload(t, "application/pdf", new Uint8Array(10 * 1024 * 1024 + 1));
    const res = await t.request("/api/files/finalize", json("POST", { id, name: "big.pdf" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ size: 10 * 1024 * 1024 + 1 });
  });

  it("refuses to finalize a missing upload and a name with a slash", async () => {
    const t = await open({ user: mockUsers.user() });
    const missing = await t.request("/api/files/finalize", json("POST", { id: crypto.randomUUID(), name: "a.txt" }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "HTTP.NOT_FOUND" } });
    const slash = await t.request("/api/files/finalize", json("POST", { id: crypto.randomUUID(), name: "../x" }));
    expect(slash.status).toBe(400);
  });
});

describe("admin (secrets, access levels)", () => {
  it("refuses a user and lets an admin check the secret", async () => {
    const t = await open({ secrets: { apiKey: "test-api-key" } });
    expect((await t.as(mockUsers.user()).request("/api/admin/secret")).status).toBe(403);
    const res = await t.as(mockUsers.admin()).request("/api/admin/secret");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("test-api-key");
    const body: SecretCheck = JSON.parse(text);
    expect(body).toEqual({ configured: true });
  });

  it("reports a missing secret without revealing anything", async () => {
    const t = await open({ user: mockUsers.admin() });
    const res = await t.request("/api/admin/secret");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "SEC.MISSING" } });
  });
});
```

## `apps/template/tests/smoke/smoke.test.ts`

<!-- example-source: apps/template/tests/smoke/smoke.test.ts -->
```ts
import { connectTestStage, createTestApp, mockUsers, type TestApp } from "@lago-morph/prototype-framework/testing";
import { afterAll, beforeAll, expect, inject, it } from "vitest";
import app from "../../src/app";
import type { Greeting, NoteList, Status } from "../../src/shared/types";

declare module "vitest" {
  interface ProvidedContext {
    /** Set by the `smoke` command: run against the stage it targets instead of in-process. */
    prototypeFrameworkSmoke: boolean;
  }
}

// One file, two ways: in-process during `verify`, against the dev server or a test stage under `smoke`.
let base: TestApp;
let user: TestApp;

beforeAll(async () => {
  base = inject("prototypeFrameworkSmoke") === true
    ? await connectTestStage()
    : await createTestApp(app, { secrets: { apiKey: "smoke-test-api-key" } });
  user = base.as(mockUsers.user(`smoke-${crypto.randomUUID()}`));
});

afterAll(async () => {
  await user.dispose();
  await base.dispose();
});

it("the app is healthy", async () => {
  const res = await base.request("/api/__framework/health");
  expect(res.status).toBe(204);
});

it("anyone can read the greeting", async () => {
  const res = await base.request("/api/hello");
  expect(res.status).toBe(200);
  const body: Greeting = await res.json();
  expect(typeof body.greeting).toBe("string");
});

it("a user can write a note and read it back", async () => {
  const created = await user.request("/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "smoke note" }),
  });
  expect(created.status).toBe(201);
  const res = await user.request("/api/notes");
  expect(res.status).toBe(200);
  const body: NoteList = await res.json();
  expect(body.notes.map((n) => n.text)).toEqual(["smoke note"]);
});

it("a user can set and read their status", async () => {
  const put = await user.request("/api/status", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "smoking" }),
  });
  expect(put.status).toBe(200);
  const body: Status = await (await user.request("/api/status")).json();
  expect(body.status).toBe("smoking");
});
```

## `apps/reference/tests/support.ts`

<!-- example-source: apps/reference/tests/support.ts -->
```ts
import { createTestApp, type TestApp, type TestAppOptions } from "@lago-morph/prototype-framework/testing";
import { afterEach } from "vitest";
import app from "../src/app";

/** A JSON request init. */
export function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

let opened: TestApp[] = [];

/** Opens an in-process reference app, disposed after the test. */
export async function open(options?: TestAppOptions): Promise<TestApp> {
  const t = await createTestApp(app, options);
  opened.push(t);
  return t;
}

afterEach(async () => {
  await Promise.all(opened.map((t) => t.dispose()));
  opened = [];
});

/** The error body of a framework error response. */
export interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string; readonly requestId: string };
}
```

## `apps/template/tests/e2e/api/notes.spec.ts`

<!-- example-source: apps/template/tests/e2e/api/notes.spec.ts -->
```ts
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import type { NoteList } from "../../../src/shared/types";

/**
 * The notes flow end to end, through the HTTP API of a local `dev` server: a person signs in,
 * writes notes and lists their own. Most of a flow's e2e cases are API tests like these.
 *
 * Edge cases, listed before the tests (the skill's reference/testing/e2e.md):
 * - Boundaries: empty text and text of only spaces are refused; 500 characters are accepted; 501 are refused.
 * - Text: Unicode text comes back unchanged; surrounding spaces are trimmed. Case, `..`, `/`,
 *   percent-encoding and prefix names do not apply: a note is free text, never a name or a path.
 * - Order and time: not asserted here. Two notes made in the same millisecond tie on their time and
 *   fall back to their random IDs; there is no expiry.
 * - Access: anonymous is refused (401); another user does not see the notes. Admin does not apply:
 *   the notes routes treat an admin as any user, and there is no admin view of notes.
 * - Repetition: the same text twice makes two notes. Concurrent writes do not apply: each request
 *   inserts one row with a new ID, and the notes contract promises nothing about concurrency.
 * - Failures: an unavailable database is simulated in-process only (`setUnavailable`, tests/app.test.ts).
 */

/** Signs `request` in as a fresh mock user (local data is kept between runs) and returns its ID. */
async function signIn(request: APIRequestContext): Promise<string> {
  const id = `e2e-${crypto.randomUUID()}`;
  const res = await request.post("/api/auth/mock-login", { data: { level: "user", id } });
  expect(res.status()).toBe(204);
  return id;
}

async function errorCode(res: APIResponse): Promise<string | undefined> {
  const body: { error?: { code?: string } } = await res.json();
  return body.error?.code;
}

test("a signed-in user writes notes and lists only their own", async ({ request }) => {
  await signIn(request);
  const text = `Ünïcödé ✓ ${crypto.randomUUID()}`;
  const created = await request.post("/api/notes", { data: { text: `  ${text}  ` } });
  expect(created.status()).toBe(201);
  const again = await request.post("/api/notes", { data: { text } });
  expect(again.status()).toBe(201);

  const mineRes = await request.get("/api/notes");
  expect(mineRes.status()).toBe(200);
  const mine: NoteList = await mineRes.json();
  expect(mine.notes.filter((n) => n.text === text)).toHaveLength(2);

  // A new mock login replaces the session: now another user.
  await signIn(request);
  const theirsRes = await request.get("/api/notes");
  expect(theirsRes.status()).toBe(200);
  const theirs: NoteList = await theirsRes.json();
  expect(theirs.notes.filter((n) => n.text === text)).toEqual([]);
});

test("anonymous requests are refused", async ({ request }) => {
  const list = await request.get("/api/notes");
  expect(list.status()).toBe(401);
  expect(await errorCode(list)).toBe("AUTH.UNAUTHENTICATED");
  const write = await request.post("/api/notes", { data: { text: "hello" } });
  expect(write.status()).toBe(401);
});

test("note text must be 1 to 500 characters after trimming", async ({ request }) => {
  await signIn(request);
  for (const text of ["", "   ", "x".repeat(501)]) {
    const res = await request.post("/api/notes", { data: { text } });
    expect(res.status(), JSON.stringify(text.slice(0, 20))).toBe(400);
    expect(await errorCode(res)).toBe("HTTP.INVALID_INPUT");
  }
  expect((await request.post("/api/notes", { data: { text: "x".repeat(500) } })).status()).toBe(201);
  const missing = await request.post("/api/notes", { data: {} });
  expect(missing.status()).toBe(400);
  expect(await errorCode(missing)).toBe("HTTP.INVALID_INPUT");
});
```

## `apps/template/tests/e2e/ui/account.spec.ts`

<!-- example-source: apps/template/tests/e2e/ui/account.spec.ts -->
```ts
import { expect, test } from "@playwright/test";

/**
 * What only a browser shows: the home page renders the greeting, and the login button signs in
 * (locally, the authentication mock's default user). Every other case is an API test (../api/).
 *
 * Edge cases, listed before the test (the skill's reference/testing/e2e.md): access is the one that
 * applies here (anonymous sees "Log in", a signed-in user sees "Log out"); boundaries, text, order,
 * repetition and failures are covered by the API and in-process tests.
 */
test("the login button signs in, and the page shows who is logged in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hello");
  await expect(page.getByText("You are not logged in.")).toBeVisible();

  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText(/^Logged in as .+ \(user\)\.$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByText("You are not logged in.")).toBeVisible();
});
```
