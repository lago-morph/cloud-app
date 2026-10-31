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
