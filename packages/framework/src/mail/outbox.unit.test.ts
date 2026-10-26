/**
 * `createTestApp`'s in-memory outbox and MAIL's test senders (testing.d.ts `TestApp.mail`,
 * `mailSender`). Unit evidence only.
 */
import { describe, expect, it } from "vitest";
import { createOutbox, failingMailSender, neverCompletingMailSender } from "./outbox.js";
import { mailErrorCode } from "./sender.js";

const A = "a@example.test";
const B = "b@example.test";
const msg = (to: string, subject: string) => ({ to, subject, text: "t", html: "<p>h</p>" });

describe("createOutbox", () => {
  it("keeps every message in order; lastTo is the latest to an address", async () => {
    let n = 0;
    const outbox = createOutbox({ senderName: "Demo", now: () => new Date(Date.UTC(2026, 9, 25, 10, 0, n++)) });
    expect(await outbox.lastTo(A)).toBeUndefined();
    await outbox.sender.send(msg(A, "one"));
    await outbox.sender.send(msg(B, "two"));
    await outbox.sender.send(msg(A, "three"));
    expect((await outbox.all()).map((m) => m.subject)).toEqual(["one", "two", "three"]);
    expect(await outbox.lastTo(A)).toEqual({ ...msg(A, "three"), from: "Demo <no-reply@localhost>", sentAt: "2026-10-25T10:00:02.000Z" });
    expect((await outbox.lastTo(B))?.subject).toBe("two");
  });

  it("all() is a snapshot", async () => {
    const outbox = createOutbox({ senderName: "Demo" });
    const before = await outbox.all();
    await outbox.sender.send(msg(A, "one"));
    expect(before).toEqual([]);
  });
});

describe("test senders", () => {
  it("the failing sender rejects every send with an error code", async () => {
    const failure = await failingMailSender().send(msg(A, "x")).catch((e: unknown) => e);
    expect(mailErrorCode(failure)).toBe("E_TEST_SEND_FAILED");
  });

  it("the never-completing sender never settles", async () => {
    const result = await Promise.race([neverCompletingMailSender().send(msg(A, "x")).then(() => "settled"), new Promise((r) => setTimeout(() => r("pending"), 20))]);
    expect(result).toBe("pending");
  });
});
