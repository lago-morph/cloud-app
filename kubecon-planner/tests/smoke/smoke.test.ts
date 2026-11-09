import { connectTestStage, createTestApp, mockUsers, type TestApp } from "@lago-morph/prototype-framework/testing";
import { afterAll, beforeAll, expect, inject, it, vi } from "vitest";
import app from "../../src/app";
import type { ImportResult, MySchedule, ScheduleMeta, SessionList } from "../../src/shared/types";
import { fakeSessionize } from "../support/feeds";

declare module "vitest" {
  interface ProvidedContext {
    /** Set by the `smoke` command: run against the stage it targets instead of in-process. */
    prototypeFrameworkSmoke: boolean;
  }
}

// One file, two ways: in-process during `verify` (Sessionize answered from fixtures), against the
// dev server or a test stage under `smoke` (the stage fetches the real feeds).
let base: TestApp;
let user: TestApp;
const smoke = inject("prototypeFrameworkSmoke") === true;

beforeAll(async () => {
  if (!smoke) fakeSessionize();
  base = smoke ? await connectTestStage() : await createTestApp(app);
  user = base.as(mockUsers.user(`smoke-${crypto.randomUUID()}`));
});

afterAll(async () => {
  await user.dispose();
  await base.dispose();
  vi.unstubAllGlobals();
});

it("the app is healthy", async () => {
  const res = await base.request("/api/__framework/health");
  expect(res.status).toBe(204);
});

it("the schedule is imported if empty (SQL, KV, outbound fetch)", async () => {
  const res = await user.request("/api/schedule/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ onlyIfEmpty: true }),
  });
  expect(res.status).toBe(200);
  const result: ImportResult = await res.json();
  expect(result.sessions).toBeGreaterThan(0);
  const meta: ScheduleMeta = await (await user.request("/api/schedule/meta")).json();
  expect(meta.sessionCount).toBeGreaterThan(0);
  expect(meta.lastImport).not.toBeNull();
});

it("a user can add a session to their schedule and see it", async () => {
  const { sessions }: SessionList = await (await user.request("/api/sessions")).json();
  const first = sessions[0];
  expect(first).toBeDefined();
  if (first === undefined) return;
  expect((await user.request(`/api/my-schedule/${first.id}`, { method: "PUT" })).status).toBe(204);
  const mine: MySchedule = await (await user.request("/api/my-schedule")).json();
  expect(mine.days.flatMap((d) => d.sessions.map((s) => s.id))).toEqual([first.id]);
  expect((await user.request(`/api/my-schedule/${first.id}`, { method: "DELETE" })).status).toBe(204);
});
