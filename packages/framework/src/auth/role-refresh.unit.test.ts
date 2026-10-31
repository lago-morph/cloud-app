import { describe, expect, it } from "vitest";
import { ROLE_REFRESH_INTERVAL_SECONDS, ROLE_REFRESH_RETRIES, ROLE_REFRESH_RETRY_DELAY_MS, readWithRetries, refreshDue } from "./role-refresh.js";

/** A read that answers from `script` in order: an Error throws, anything else resolves. */
function scripted<T>(script: (T | Error)[]) {
  let calls = 0;
  const read = async (): Promise<T> => {
    const next = script[calls];
    calls += 1;
    if (next instanceof Error) throw next;
    return next as T;
  };
  return { read, calls: () => calls };
}

function recordingSleep() {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => void delays.push(ms) };
}

describe("role refresh (plan §4.1 step 5)", () => {
  it("PAR-425 refreshes every 5 minutes; PAR-426 retries twice; PAR-427 waits 200 ms between tries", () => {
    expect(ROLE_REFRESH_INTERVAL_SECONDS).toBe(300);
    expect(ROLE_REFRESH_RETRIES).toBe(2);
    expect(ROLE_REFRESH_RETRY_DELAY_MS).toBe(200);
  });

  it("a role is current up to and including exactly the interval, and due one second past it", () => {
    const checkedAt = 1_800_000_000;
    expect(refreshDue({ level: "user", checkedAt }, checkedAt)).toBe(false);
    expect(refreshDue({ level: "user", checkedAt }, checkedAt + ROLE_REFRESH_INTERVAL_SECONDS)).toBe(false);
    expect(refreshDue({ level: "user", checkedAt }, checkedAt + ROLE_REFRESH_INTERVAL_SECONDS + 1)).toBe(true);
  });

  it("a failed read is retried twice with the delay, then reported as failed", async () => {
    const { read, calls } = scripted<string>([new Error("1"), new Error("2"), new Error("3"), "never"]);
    const { delays, sleep } = recordingSleep();
    const result = await readWithRetries(read, { sleep });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? undefined : (result.error as Error).message).toBe("3");
    expect(calls()).toBe(1 + ROLE_REFRESH_RETRIES);
    expect(delays).toStrictEqual([ROLE_REFRESH_RETRY_DELAY_MS, ROLE_REFRESH_RETRY_DELAY_MS]);
  });

  it("a retry that succeeds is the answer", async () => {
    for (const failures of [1, 2]) {
      const { read, calls } = scripted<string>([...Array.from({ length: failures }, () => new Error("down")), "admin"]);
      const { delays, sleep } = recordingSleep();
      expect(await readWithRetries(read, { sleep })).toStrictEqual({ ok: true, value: "admin" });
      expect(calls()).toBe(failures + 1);
      expect(delays).toHaveLength(failures);
    }
  });

  it("an answer, null included, is not retried", async () => {
    const { read, calls } = scripted<string | null>([null, "admin"]);
    const { delays, sleep } = recordingSleep();
    expect(await readWithRetries(read, { sleep })).toStrictEqual({ ok: true, value: null });
    expect(calls()).toBe(1);
    expect(delays).toStrictEqual([]);
  });
});
