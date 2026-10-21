import { describe, expect, it } from "vitest";
import { failureOutput } from "./stage.js";

describe("failureOutput (MIG-AC-002 root cause: keep the evidence a failed deploy needs)", () => {
  const fatal = "[wrangler] *** Fatal uncaught kj::Exception: rust/cxx/kj-rs-io/ffi.rs:209: failed: bind(): Address already in use (os error 98)";
  const filler = "x".repeat(3000);

  it("keeps the first `***` fatal line when the tail has cut it off, then the tail", () => {
    const output = `dev: built reference\n${fatal}\n[wrangler] *** second\n${filler}\ndev failed: wrangler exited with status 1 before serving\n`;
    const message = failureOutput(output);
    expect(message.startsWith(`${fatal}\n[…]\n`)).toBe(true);
    expect(message).not.toContain("*** second");
    expect(message.endsWith(output.slice(-1500))).toBe(true);
  });

  it("keeps the first `Runtime stderr:` block", () => {
    const output = `[wrangler] The Workers runtime failed to start. Runtime stderr: boom\n[wrangler] frame 1\n\n${filler}`;
    const message = failureOutput(output);
    expect(message).toContain("Runtime stderr: boom\n[wrangler] frame 1\n[…]\n");
    expect(message.endsWith(output.slice(-1500))).toBe(true);
  });

  it("is the tail alone when there is no fatal line before it", () => {
    const output = `${filler}\n${fatal}\nend`;
    expect(failureOutput(output)).toBe(output.slice(-1500));
    expect(failureOutput("short")).toBe("short");
  });
});
