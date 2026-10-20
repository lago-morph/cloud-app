import { describe, expect, it } from "vitest";
import { defineApp } from "../../index.js";
import type { ResolvedConfig } from "../../config/resolve.js";
import { FrameworkError } from "../../core/errors.js";
import { createDeployment } from "../../core/identity.js";
import { createCloudflareWorker } from "./public.js";
import { FRAMEWORK_SECRETS } from "../../secrets/names.js";
import { BINDINGS } from "./bindings.js";
import { workerTicketIssuer } from "./tickets.js";

const secrets = async (name: string) => {
  if (name === FRAMEWORK_SECRETS.r2AccessKeyId) return "AKIDEXAMPLE";
  if (name === FRAMEWORK_SECRETS.r2SecretAccessKey) return "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
  throw new Error(`unexpected ${name}`);
};

describe("Cloudflare Worker ticket wiring (D-02 issuer, location from Worker variables; D-05)", () => {
  it("signs tickets for the account and stage bucket named by the Worker variables", async () => {
    const env = { [BINDINGS.r2AccountId]: "acc123", [BINDINGS.filesBucket]: "notes-test-abc-files" };
    const ticket = (await workerTicketIssuer(env, secrets).upload("a.txt", "text/plain")) as { url: string };
    expect(new URL(ticket.url).host).toBe("acc123.r2.cloudflarestorage.com");
    expect(new URL(ticket.url).pathname).toBe("/notes-test-abc-files/a.txt");
  });

  it("without the variables, creating a ticket is CORE.MISCONFIGURED; building the issuer is not", async () => {
    const issuer = workerTicketIssuer({}, secrets);
    await expect(issuer.download("a.txt")).rejects.toThrow(FrameworkError);
    await expect(issuer.upload("a.txt", "text/plain")).rejects.toThrow(/FRAMEWORK_R2_ACCOUNT_ID/);
  });

  it("the variables are not SECRET_* names (DEC-0087)", () => {
    expect(BINDINGS.r2AccountId.startsWith("SECRET_")).toBe(false);
    expect(BINDINGS.filesBucket.startsWith("SECRET_")).toBe(false);
  });
});

describe("createCloudflareWorker issues signed R2 tickets (D-02 wired by D-05)", () => {
  it("an app's upload ticket on a Cloudflare stage addresses the stage bucket on R2's S3 endpoint", async () => {
    const app = defineApp({
      name: "cfticket",
      config: {},
      secrets: [],
      tables: {},
      routes: (api) => {
        api.post("/ticket", async (c) => c.json(await c.var.files.createUploadTicket("a.txt", { contentType: "text/plain" })));
      },
    });
    const resolved: ResolvedConfig = { deployment: createDeployment({ app: "cfticket", stage: "test-unit", target: "cloudflare" }), values: {}, admins: [], secrets: [] };
    const origin = "https://cfticket-test-unit.example.workers.dev";
    const env = {
      // The route touches no SQL; the database binding only has to exist.
      DB: { prepare: () => Promise.reject(new Error("no SQL in this test")), batch: () => Promise.reject(new Error("no SQL in this test")) },
      FILES: { head: async () => null },
      FRAMEWORK_PUBLIC_ORIGIN: origin,
      [BINDINGS.r2AccountId]: "acc123",
      [BINDINGS.filesBucket]: "cfticket-test-unit-files",
      SECRET_FRAMEWORK_SESSION_KEY: "s".repeat(43),
      SECRET_FRAMEWORK_R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
      SECRET_FRAMEWORK_R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    };
    const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} };
    const res = await createCloudflareWorker(app, resolved).fetch(new Request(`${origin}/api/ticket`, { method: "POST", headers: { origin } }), env, ctx);
    const body = (await res.json()) as { url?: string };
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.url).toMatch(/^https:\/\/acc123\.r2\.cloudflarestorage\.com\/cfticket-test-unit-files\/a\.txt\?/);
    expect(body.url).toContain("X-Amz-Signature=");
  });
});
