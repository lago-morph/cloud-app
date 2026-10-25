/**
 * The mail-sink reader (mail.md §2 "Reading mail"; `mail last --target cloudflare`, `check-login`)
 * against the in-memory Cloudflare account, with objects written by the sink Worker's own handler.
 * No network.
 */
import { describe, expect, it } from "vitest";
import { captureIo } from "../../cli/io.test-support.js";
import { cloudflareSinkReader, mailCommand } from "../../cli/commands/mail.js";
import { MAIL_SINK_BINDING, MAIL_SINK_SOURCE } from "../../mail/sink-worker.js";
import { ACCOUNT, FakeCloud } from "./fake-cloud.test-support.js";
import { keyTime, latestSinkMail, readSinkMail, sinkKeys } from "./mail-sink.js";

const TO = "sink+run1@t.example.test";
const raw = (subject: string, link: string) =>
  [`From: Demo <no-reply@example.test>`, `To: ${TO}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", `Open ${link}`, ""].join("\r\n");

/** Runs the uploaded sink source on a message and copies what it stored into the fake account's bucket. */
async function deliver(cloud: FakeCloud, to: string, message: string): Promise<string> {
  const sink = new Function(MAIL_SINK_SOURCE.replace("export default", "return"))() as { email(m: unknown, env: unknown): Promise<void> };
  let stored = "";
  const bucket = {
    put: async (key: string, body: ArrayBuffer) => {
      stored = key;
      cloud.putObject("prototype-mailsink", key, new TextDecoder().decode(body));
    },
  };
  await sink.email({ to, raw: new Blob([message]).stream() }, { [MAIL_SINK_BINDING]: bucket });
  await new Promise((r) => setTimeout(r, 2));
  return stored;
}

function account(): FakeCloud {
  const cloud = FakeCloud.withSharedResources();
  cloud.buckets.set("prototype-mailsink", new Set());
  cloud.putObject("sst-state", "framework/account.json", "");
  cloud.objectBodies.set("sst-state/framework/account.json", { emailDomain: "example.test" });
  return cloud;
}

describe("the mail-sink reader", () => {
  it("returns the latest message to the address as a MailMessage, reading only", async () => {
    const cloud = account();
    await deliver(cloud, TO, raw("Verify", "https://a.example.test/v?token=1"));
    await deliver(cloud, "sink+other@t.example.test", raw("Other", "https://a.example.test/o"));
    const latest = await deliver(cloud, TO, raw("Reset", "https://a.example.test/r?token=2"));
    expect(await sinkKeys(cloud.api, ACCOUNT, TO)).toHaveLength(2);
    const message = await readSinkMail(cloud.api, ACCOUNT, "Sink+Run1@t.example.test");
    expect(message).toMatchObject({ to: TO, from: "Demo <no-reply@example.test>", subject: "Reset", text: "Open https://a.example.test/r?token=2\n", html: "" });
    expect(message!.sentAt).toBe(keyTime(latest));
    expect(cloud.requests.every((r) => r.startsWith("GET "))).toBe(true);
    expect(cloud.requests.some((r) => r.includes(`objects?prefix=${encodeURIComponent(`${TO}/`)}`))).toBe(true);
  });

  it("is undefined for an address with no mail, and refuses an address outside t.<emailDomain> before listing", async () => {
    const cloud = account();
    expect(await latestSinkMail(cloud.api, ACCOUNT, "sink+none@t.example.test")).toBeUndefined();
    cloud.requests.length = 0;
    await expect(readSinkMail(cloud.api, ACCOUNT, "someone@example.test")).rejects.toThrow(/only addresses under the test mailbox subdomain/);
    expect(cloud.requests.some((r) => r.includes("prototype-mailsink"))).toBe(false);
  });

  it("names setup-account when the record has no domain or the sink bucket is missing", async () => {
    const empty = FakeCloud.withSharedResources();
    await expect(readSinkMail(empty.api, ACCOUNT, TO)).rejects.toThrow(/names no email domain; run setup-account/);
    const noBucket = account();
    noBucket.buckets.delete("prototype-mailsink");
    await expect(readSinkMail(noBucket.api, ACCOUNT, TO)).rejects.toThrow(/bucket prototype-mailsink does not exist; run setup-account/);
  });

  it("keyTime reads the sink's fixed-width timestamp", () => {
    expect(keyTime("a@t.example.test/20261025T100001123Z-0f.eml")).toBe("2026-10-25T10:00:01.123Z");
  });
});

describe("mail last --target cloudflare (cli.md §2)", () => {
  it("prints the sink's latest message through the real API seam, without the token or account ID", async () => {
    const cloud = account();
    await deliver(cloud, TO, raw("Verify", "https://a.example.test/v?token=1"));
    // A fetch that answers from the fake account, as the real API seam would call it.
    const fetchFake = (async (input: string, init?: RequestInit) => {
      const path = String(input).replace("https://api.cloudflare.com/client/v4", "");
      const r = await cloud.api((init?.method ?? "GET") as "GET", path);
      return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status });
    }) as unknown as typeof fetch;
    const env = { CLOUDFLARE_API_TOKEN: "secret-token-value", CLOUDFLARE_ACCOUNT_ID: ACCOUNT };
    const io = captureIo();
    expect(await mailCommand({ cloud: cloudflareSinkReader(env, fetchFake) })(["last", "--to", TO, "--target", "cloudflare"], io)).toBe(0);
    expect(JSON.parse(io.out)).toMatchObject({ to: TO, subject: "Verify" });
    expect(io.out + io.err).not.toContain("secret-token-value");
    expect(io.out + io.err).not.toContain(ACCOUNT);
  });

  it("refuses before any request without credentials or behind a proxy without NODE_USE_ENV_PROXY", async () => {
    let calls = 0;
    const counting = (async () => (calls++, new Response("{}"))) as unknown as typeof fetch;
    await expect(cloudflareSinkReader({ PATH: "/usr/bin" }, counting)(TO)).rejects.toThrow(/missing Cloudflare credentials: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID/);
    await expect(cloudflareSinkReader({ HTTPS_PROXY: "http://proxy.example.test", CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" }, counting)(TO)).rejects.toThrow(/NODE_USE_ENV_PROXY=1/);
    expect(calls).toBe(0);
  });
});
