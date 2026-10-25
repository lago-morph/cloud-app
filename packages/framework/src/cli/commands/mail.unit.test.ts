/**
 * `mail last --to <address> [--target local|cloudflare]` (cli.md §2; mail.md §2 "Reading mail").
 * Unit evidence only.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UsageError } from "../args.js";
import { captureIo } from "../io.test-support.js";
import { createDevMailCapture } from "../../mail/local-files.js";
import { workerOutputMailSender } from "../../mail/local.js";
import { mailCommand } from "./mail.js";

const TO = "someone@example.test";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function appWithMail(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "mail-cli-"));
  dirs.push(dir);
  const handle = createDevMailCapture(dir, () => undefined);
  let n = 0;
  const sender = workerOutputMailSender({ senderName: "Demo", print: handle, now: () => new Date(Date.UTC(2026, 9, 25, 10, 0, n++)) });
  await sender.send({ to: TO, subject: "Verify", text: "first", html: "<p>first</p>" });
  await sender.send({ to: TO, subject: "Reset", text: "second", html: "<p>second</p>" });
  return dir;
}

describe("mail last", () => {
  it("prints the latest captured message to the address as JSON", async () => {
    const dir = await appWithMail();
    const io = captureIo(dir);
    expect(await mailCommand()(["last", "--to", TO], io)).toBe(0);
    expect(JSON.parse(io.out)).toEqual({ to: TO, from: "Demo <no-reply@localhost>", subject: "Reset", text: "second", html: "<p>second</p>", time: "2026-10-25T10:00:01.000Z" });
    const explicit = captureIo(dir);
    expect(await mailCommand()(["last", `--to=${TO}`, "--target", "local"], explicit)).toBe(0);
    expect(explicit.out).toBe(io.out);
  });

  it("exits 1 when there is no message to the address, without echoing it", async () => {
    const dir = await appWithMail();
    const io = captureIo(dir);
    expect(await mailCommand()(["last", "--to", "nobody@example.test"], io)).toBe(1);
    expect(io.out).toBe("");
    expect(io.err).not.toContain("nobody@example.test");
  });

  it("refuses a wrong action, a missing --to, an unknown option or target", async () => {
    const io = captureIo();
    await expect(mailCommand()([], io)).rejects.toThrow(UsageError);
    await expect(mailCommand()(["first", "--to", TO], io)).rejects.toThrow(UsageError);
    await expect(mailCommand()(["last"], io)).rejects.toThrow(/--to/);
    await expect(mailCommand()(["last", "--to", TO, "--stage", "x"], io)).rejects.toThrow(UsageError);
    await expect(mailCommand()(["last", "--to", TO, "--target", "aws"], io)).rejects.toThrow(/--target/);
  });

  it("--target cloudflare reads through the sink reader it is given, and fails without one", async () => {
    const io = captureIo();
    expect(await mailCommand()(["last", "--to", TO, "--target", "cloudflare"], io)).toBe(1);
    expect(io.err).toMatch(/mail sink/);
    const seen: string[] = [];
    const withSink = captureIo();
    const cloud = async (address: string) => {
      seen.push(address);
      return { to: address, subject: "Verify" };
    };
    expect(await mailCommand({ cloud })(["last", "--to", TO, "--target", "cloudflare"], withSink)).toBe(0);
    expect(seen).toEqual([TO]);
    expect(JSON.parse(withSink.out)).toEqual({ to: TO, subject: "Verify" });
    expect(await mailCommand({ cloud: async () => undefined })(["last", "--to", TO, "--target", "cloudflare"], captureIo())).toBe(1);
  });
});
