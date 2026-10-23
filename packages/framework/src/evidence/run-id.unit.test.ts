import { describe, expect, it } from "vitest";
import { RUN_ID_ALPHABET, RUN_ID_LENGTH, newRunId, testStageName } from "./run-id.js";

describe("[COMPL-AC-004] test-stage run IDs", () => {
  it("fill PAR-291 (20 characters) after `test-` with lowercase letters and digits", () => {
    expect(RUN_ID_ALPHABET).toBe("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(RUN_ID_LENGTH).toBe(15);
    const id = newRunId();
    expect(id).toMatch(/^[a-z0-9]{15}$/);
    const stage = testStageName(id);
    expect(stage).toBe(`test-${id}`);
    expect(stage).toHaveLength(20);
  });

  it("differ between two runs", () => {
    expect(newRunId()).not.toBe(newRunId());
  });

  it("map random bytes without bias: bytes at or above 252 are discarded", () => {
    const bytes = [255, 252, 0, 1, 35, 36, 251, ...Array<number>(20).fill(2)];
    let next = 0;
    const source = (buffer: Uint8Array): Uint8Array => {
      for (let i = 0; i < buffer.length; i += 1) buffer[i] = bytes[next++ % bytes.length] ?? 0;
      return buffer;
    };
    // 0→a, 1→b, 35→9, 36→a (36 mod 36), 251→251 mod 36 = 35 → 9, then 2→c …
    expect(newRunId(source)).toBe("ab9a9cccccccccc");
  });

  it("refuses to build a stage name from an ID of the wrong form", () => {
    expect(() => testStageName("ABC")).toThrow(/run ID/);
    expect(() => testStageName("a".repeat(16))).toThrow(/run ID/);
  });
});
