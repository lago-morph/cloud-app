/**
 * `TestApp.mail` (testing.d.ts): `createTestApp`'s in-memory outbox with the `mailSender`
 * option, and a connected stage's capture (the test-mail route on a cloud test stage, `.mail/`
 * locally). A stand-in route sends through the stage's request sender as PWD will. Unit evidence only.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeContext } from "../core/assemble.js";
import { defineApp } from "../index.js";
import { createDevMailCapture } from "../mail/local-files.js";
import { workerOutputMailSender } from "../mail/local.js";
import { sendRequestMail } from "../mail/request.js";
import { connectWith, type SmokeConnection } from "./connect.js";
import { createTestApp, type TestApp } from "./test-app.js";

const TO = "someone@example.test";

const app = defineApp({
  name: "mailunit",
  config: {},
  secrets: [],
  tables: {},
  routes: (api) => {
    api.post("/send", (c) => {
      sendRequestMail(c as unknown as RuntimeContext, { to: TO, subject: "Verify", text: "Open the link", html: "<p>Open the link</p>" });
      return c.json({ result: "check-email" });
    });
  },
});

const apps: TestApp[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.dispose();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function open(options: Parameters<typeof createTestApp>[1] = {}): Promise<TestApp> {
  const t = await createTestApp(app, options);
  apps.push(t);
  return t;
}

describe("createTestApp's outbox", () => {
  it("captures what the stage's sender sends, from '<app name> <no-reply@localhost>'", async () => {
    const t = await open();
    expect(await t.mail.lastTo(TO)).toBeUndefined();
    const res = await t.request("/api/send", { method: "POST" });
    expect(await res.json()).toEqual({ result: "check-email" });
    await new Promise((r) => setTimeout(r, 0));
    expect(await t.mail.all()).toHaveLength(1);
    expect(await t.mail.lastTo(TO)).toMatchObject({ to: TO, from: "mailunit <no-reply@localhost>", subject: "Verify", text: "Open the link" });
    expect(t.as({ level: "user", id: "u1", displayName: "U" }).mail).toBe(t.mail);
  });

  it("with a failing sender the answer is the same, and one MAIL entry names the code but not the address", async () => {
    const t = await open({ mailSender: "failing" });
    const res = await t.request("/api/send", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "check-email" });
    await new Promise((r) => setTimeout(r, 0));
    const entries = t.logs().filter((e) => e.component === "MAIL");
    expect(entries.map((e) => [e.severity, e.message])).toEqual([["error", "mail send failed: E_TEST_SEND_FAILED"]]);
    expect(JSON.stringify(t.logs())).not.toContain(TO);
    expect(await t.mail.all()).toEqual([]);
  });

  it("with a sender that never completes the response still arrives", async () => {
    const t = await open({ mailSender: "never-completing" });
    const res = await t.request("/api/send", { method: "POST" });
    expect(res.status).toBe(200);
  });
});

describe("a connected stage's mail", () => {
  const CLOUD: SmokeConnection = { target: "cloudflare", stage: "test-abc", baseUrl: "https://template-test-abc.sub.workers.dev" };
  const LOCAL: SmokeConnection = { target: "local", stage: "local", baseUrl: "http://localhost:5179" };
  const message = { to: TO, from: "Demo <no-reply@localhost>", subject: "Verify", text: "t", html: "h", sentAt: "2026-10-25T10:00:00.000Z" };

  it("on a cloud test stage reads the test-mail route; 404 is no message; all() is refused", async () => {
    const asked: string[] = [];
    const fetch = async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.pathname === "/api/auth/me") return Response.json({ level: "anonymous" });
      asked.push(`${url.pathname}${url.search}`);
      return url.searchParams.get("to") === TO ? Response.json(message) : Response.json({ error: { code: "HTTP.NOT_FOUND", message: "none", requestId: "r" } }, { status: 404 });
    };
    const stage = await connectWith(CLOUD, fetch);
    expect(await stage.mail.lastTo(TO)).toEqual(message);
    expect(await stage.mail.lastTo("nobody@example.test")).toBeUndefined();
    expect(asked[0]).toBe(`/api/__framework/test-mail?to=${encodeURIComponent(TO)}`);
    await expect(stage.mail.all()).rejects.toThrow(/one address at a time/);
  });

  it("an unexpected answer from the route is an error naming the status and code", async () => {
    const fetch = async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.pathname === "/api/auth/me") return Response.json({ level: "anonymous" });
      return Response.json({ error: { code: "CORE.INTERNAL", message: "x", requestId: "r-2" } }, { status: 500 });
    };
    const stage = await connectWith(CLOUD, fetch);
    await expect(stage.mail.lastTo(TO)).rejects.toThrow(/HTTP 500, error code CORE.INTERNAL, requestId r-2/);
  });

  it("locally reads the app's .mail/, which dev writes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mail-connect-"));
    dirs.push(dir);
    const sender = workerOutputMailSender({ senderName: "Demo", print: createDevMailCapture(dir, () => undefined), now: () => new Date(message.sentAt) });
    await sender.send({ to: TO, subject: "Verify", text: "t", html: "h" });
    const fetch = async (): Promise<Response> => Response.json({ level: "anonymous" });
    const stage = await connectWith(LOCAL, fetch, dir);
    // A .mail/ file holds no sender (mail.md §2), so `from` is the bare local address.
    expect(await stage.mail.lastTo(TO)).toEqual({ ...message, from: "no-reply@localhost" });
    expect(await stage.mail.lastTo("nobody@example.test")).toBeUndefined();
  });
});
