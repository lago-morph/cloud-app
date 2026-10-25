import { describe, expect, it } from "vitest";
import { FrameworkError } from "../core/errors.js";
import { UsageError } from "./args.js";
import { captureIo } from "./io.test-support.js";
import { COMMAND_NAMES, runCommand } from "./main.js";

describe("command dispatch (CLI-REQ-001, CLI-REQ-003)", () => {
  it("an unknown command exits non-zero with the usage on stderr", async () => {
    const io = captureIo();
    const code = await runCommand(["frobnicate"], io);
    expect(code).toBe(2);
    expect(io.err).toMatch(/unknown command/);
    expect(io.err).toMatch(/usage/i);
  });

  it("no command prints the usage listing every command and exits 2", async () => {
    const io = captureIo();
    expect(await runCommand([], io)).toBe(2);
    for (const name of COMMAND_NAMES) expect(io.err).toContain(name);
  });

  it("registers every CLI-REQ-001 command", () => {
    expect([...COMMAND_NAMES].sort()).toEqual(
      ["build", "certify-auth", "deploy", "dev", "generate-migration", "mail", "remove", "reset-local", "secrets", "setup-account", "smoke", "verify"].sort(),
    );
  });

  it("the cloud commands (D-05) are bound to their implementations, not the not-yet stub", async () => {
    for (const name of ["deploy", "remove", "setup-account", "certify-auth"]) {
      const io = captureIo();
      expect(await runCommand([name, "--target", "nowhere"], io), name).toBe(2);
      expect(io.err, name).not.toMatch(/not available yet/);
    }
    const secrets = captureIo("/a", ["x"]);
    expect(await runCommand(["secrets", "set", "apiKey", "--target", "cloudflare", "--stage", "Bad_Stage"], secrets)).toBe(2);
    expect(secrets.err).not.toMatch(/not available yet/);
  });

  it("[CLI-AC-005] smoke is bound to the smoke runner, not the not-yet stub", async () => {
    const io = captureIo();
    expect(await runCommand(["smoke", "--target", "nowhere"], io)).toBe(2);
    expect(io.err).not.toMatch(/not available yet/);
  });

  it("a command that throws exits 1 with the error's message, never 0", async () => {
    const io = captureIo();
    const table = { boom: { summary: "", run: async () => Promise.reject(new FrameworkError("CORE.MISCONFIGURED", "the app name bad-name is invalid")) } };
    expect(await runCommand(["boom"], io, table)).toBe(1);
    expect(io.err).toContain("the app name bad-name is invalid");
    const plain = captureIo();
    expect(await runCommand(["boom"], plain, { boom: { summary: "", run: async () => Promise.reject(new Error("disk full")) } })).toBe(1);
    expect(plain.err).toContain("disk full");
  });

  it("a usage mistake exits 2 with the command's message", async () => {
    const io = captureIo();
    expect(await runCommand(["bad"], io, { bad: { summary: "", run: async () => Promise.reject(new UsageError("--stage is missing")) } })).toBe(2);
    expect(io.err).toContain("--stage is missing");
  });
});
