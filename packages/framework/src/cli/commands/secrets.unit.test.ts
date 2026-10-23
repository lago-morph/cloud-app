import { describe, expect, it } from "vitest";
import { UsageError } from "../args.js";
import { captureIo } from "../io.test-support.js";
import { secretsCommand, type SecretsDeps } from "./secrets.js";

const value = () => `v-${crypto.randomUUID()}`;

function deps(stored: [string, string, string][] = []): SecretsDeps {
  return {
    loadDeclaredSecrets: async () => ["apiKey"],
    setLocalSecret: async (dir, name, v) => {
      stored.push([dir, name, v]);
    },
  };
}

const SET = ["set", "apiKey", "--target", "local", "--stage", "local"];

describe("secrets set --target local (SEC-REQ-004, CLI-REQ-004)", () => {
  it("[SEC-AC-004] stores the value read from standard input and never prints it", async () => {
    const secret = value();
    const stored: [string, string, string][] = [];
    const io = captureIo("/apps/one", [`${secret}\n`]);
    expect(await secretsCommand(deps(stored))(SET, io)).toBe(0);
    expect(stored).toEqual([["/apps/one", "apiKey", secret]]);
    expect(io.out + io.err).not.toContain(secret);
    expect(io.out).toContain("apiKey");
  });

  it("[SEC-AC-004] rejects a value given as an argument, without storing or printing it", async () => {
    for (const extra of [[value()], ["--value", value()], [`--value=${value()}`]]) {
      const stored: [string, string, string][] = [];
      const io = captureIo("/apps/one", ["from-stdin"]);
      const args = [...SET, ...extra];
      let thrown: unknown;
      try {
        await secretsCommand(deps(stored))(args, io);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, args.join(" ")).toBeInstanceOf(UsageError);
      expect(stored).toEqual([]);
      for (const part of extra) expect(String((thrown as Error).message)).not.toContain(part.replace("--value=", ""));
    }
  });

  it("refuses an undeclared name, an empty standard input and a subcommand other than set", async () => {
    await expect(secretsCommand(deps())(["set", "other", "--target", "local", "--stage", "local"], captureIo("/a", ["x"]))).rejects.toThrow(UsageError);
    await expect(secretsCommand(deps())(SET, captureIo("/a", []))).rejects.toThrow(UsageError);
    await expect(secretsCommand(deps())(["get", "apiKey"], captureIo("/a", ["x"]))).rejects.toThrow(UsageError);
  });

  it("--target cloudflare fails with status 1 naming the missing prerequisite, without reading stdin", async () => {
    const stored: [string, string, string][] = [];
    const io = captureIo("/a", ["x"]);
    expect(await secretsCommand(deps(stored))(["set", "apiKey", "--target", "cloudflare", "--stage", "test-x"], io)).toBe(1);
    expect(io.err).toMatch(/not available yet/);
    expect(stored).toEqual([]);
  });
});
