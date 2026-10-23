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
