import { describe, expect, it } from "vitest";
import { checkSettableName, parseSecretsSetArgs, readSecretValue, SecretsSetUsageError } from "./set-command.js";

const dummy = (label: string) => `${label}-${crypto.randomUUID()}`;

/** The thrown error, or undefined. */
function failure(fn: () => unknown): Error | undefined {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  return undefined;
}

async function* chunks(...parts: (string | Uint8Array)[]): AsyncIterable<string | Uint8Array> {
  for (const p of parts) yield p;
}

describe("reading the secret value from standard input", () => {
  it("joins string and byte chunks and removes one trailing line ending", async () => {
    const enc = new TextEncoder();
    await expect(readSecretValue(chunks("ab", enc.encode("c d"), "\n"))).resolves.toBe("abc d");
    await expect(readSecretValue(chunks("v\r\n"))).resolves.toBe("v");
    await expect(readSecretValue(chunks("v\n\n"))).resolves.toBe("v\n");
    await expect(readSecretValue(chunks("  v  "))).resolves.toBe("  v  ");
  });

  it("decodes a multi-byte character split across chunks", async () => {
    const bytes = new TextEncoder().encode("ü");
    await expect(readSecretValue(chunks(bytes.slice(0, 1), bytes.slice(1)))).resolves.toBe("ü");
  });

  it("refuses empty input", async () => {
    await expect(readSecretValue(chunks())).rejects.toThrow(/no value on standard input/);
    await expect(readSecretValue(chunks("\n"))).rejects.toThrow(/no value on standard input/);
  });
});

describe("which names `secrets set` accepts", () => {
  it("accepts a declared app secret and a framework-internal secret", () => {
    expect(() => checkSettableName("apiKey", ["apiKey"])).not.toThrow();
    expect(() => checkSettableName("frameworkGoogleClientSecret", ["apiKey"])).not.toThrow();
  });

  it("refuses any other name without repeating it, listing the names it accepts", () => {
    const typo = dummy("maybeAValue");
    const error = failure(() => checkSettableName(typo, ["apiKey"]));
    expect(error).toBeInstanceOf(SecretsSetUsageError);
    expect(error!.message).not.toContain(typo);
    expect(error!.message).toContain("apiKey");
    expect(error!.message).toContain("frameworkGoogleClientSecret");
  });
});

describe("[SEC-AC-004] `secrets set` takes the value from standard input only", () => {
  it("accepts a name, a target and a stage", () => {
    expect(parseSecretsSetArgs(["apiKey", "--target", "local", "--stage", "local"])).toEqual({ name: "apiKey", target: "local", stage: "local" });
    expect(parseSecretsSetArgs(["--target=cloudflare", "--stage=test-x", "apiKey"])).toEqual({ name: "apiKey", target: "cloudflare", stage: "test-x" });
  });

  it.each([
    ["a second positional", (v: string) => ["apiKey", v, "--target", "local", "--stage", "local"]],
    ["a trailing positional", (v: string) => ["apiKey", "--target", "local", "--stage", "local", v]],
    ["--value <v>", (v: string) => ["apiKey", "--target", "local", "--stage", "local", "--value", v]],
    ["--value=<v>", (v: string) => ["apiKey", "--target", "local", "--stage", "local", `--value=${v}`]],
    ["an unknown option carrying it", (v: string) => ["apiKey", "--target", "local", "--stage", "local", `--secret=${v}`]],
  ])("rejects a value supplied as %s, without repeating it", (_label, build) => {
    const value = dummy("argval");
    const error = failure(() => parseSecretsSetArgs(build(value)));
    expect(error).toBeDefined();
    expect(error!.message).toMatch(/standard input/);
    expect(error!.message).not.toContain(value);
  });

  it.each([
    ["no name", ["--target", "local", "--stage", "local"]],
    ["no target", ["apiKey", "--stage", "local"]],
    ["no stage", ["apiKey", "--target", "local"]],
    ["an unknown target", ["apiKey", "--target", "elsewhere", "--stage", "local"]],
    ["a repeated option", ["apiKey", "--target", "local", "--target", "local", "--stage", "local"]],
  ])("rejects %s", (_label, args) => {
    expect(failure(() => parseSecretsSetArgs(args))).toBeDefined();
  });
});
