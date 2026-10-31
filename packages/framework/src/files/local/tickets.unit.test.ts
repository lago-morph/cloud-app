import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalTicketIssuer, verifyLocalTicket } from "./tickets.js";

/** A generated dummy key, never a real credential. */
const key = `k-${crypto.randomUUID()}`;
const issuer = createLocalTicketIssuer({ key: async () => key });
const FIFTEEN_MINUTES = 15 * 60 * 1000;

function tokenOf(ticket: unknown): string {
  const url = (ticket as { url: string }).url;
  expect(url.startsWith("/api/__framework/files/")).toBe(true);
  return url.slice("/api/__framework/files/".length);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("local tickets (FILES-REQ-003, files.md §2 Local)", () => {
  it("an upload ticket is a same-origin PUT to the transfer route naming the content type, expiring after PAR-233", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
    const ticket = (await issuer.upload("a/b c.png", "image/png")) as Record<string, unknown>;
    expect(ticket).toMatchObject({ method: "PUT", headers: { "Content-Type": "image/png" }, expiresAt: Date.now() + FIFTEEN_MINUTES });
    expect(Object.keys(ticket).sort()).toEqual(["expiresAt", "headers", "method", "url"]);
    expect(tokenOf(ticket)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("a download ticket is a same-origin URL to the transfer route, expiring after PAR-233", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
    const ticket = (await issuer.download("x")) as Record<string, unknown>;
    expect(Object.keys(ticket).sort()).toEqual(["expiresAt", "url"]);
    expect(ticket["expiresAt"]).toBe(Date.now() + FIFTEEN_MINUTES);
    tokenOf(ticket);
  });

  it("verification gives back the operation, name and content type the ticket was signed for", async () => {
    const up = tokenOf(await issuer.upload("dir/../é 100%.png", "image/png"));
    const down = tokenOf(await issuer.download("dir/../é 100%.png"));
    expect(await verifyLocalTicket(up, key)).toEqual({ op: "upload", name: "dir/../é 100%.png", contentType: "image/png" });
    expect(await verifyLocalTicket(down, key)).toEqual({ op: "download", name: "dir/../é 100%.png" });
  });

  it("a ticket is valid repeatedly until PAR-233 has passed, then refused", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
    const token = tokenOf(await issuer.download("x"));
    vi.setSystemTime(Date.now() + FIFTEEN_MINUTES - 1);
    expect(await verifyLocalTicket(token, key)).toBeDefined();
    expect(await verifyLocalTicket(token, key)).toBeDefined();
    vi.setSystemTime(Date.now() + 1);
    expect(await verifyLocalTicket(token, key)).toBeUndefined();
  });

  it("a tampered, foreign-key or malformed ticket is refused", async () => {
    const token = tokenOf(await issuer.upload("a.png", "image/png"));
    const [payload = "", signature = ""] = token.split(".");
    const other = tokenOf(await issuer.upload("b.png", "image/png"));
    const otherPayload = other.split(".")[0] ?? "";
    expect(await verifyLocalTicket(`${token}x`, key)).toBeUndefined();
    expect(await verifyLocalTicket(`${otherPayload}.${signature}`, key)).toBeUndefined();
    expect(await verifyLocalTicket(`${payload}.${signature}`, `${key}-other`)).toBeUndefined();
    for (const bad of ["", ".", "abc", "a.b.c", "%%.%%", `${payload}.`]) expect(await verifyLocalTicket(bad, key)).toBeUndefined();
  });

  it("a ticket whose signature is re-spelled in its last character is refused (fuzz F4)", async () => {
    // Root cause 2026-10-31-T4-files-base64url-noncanonical: the last of 43 characters carries 2
    // unused bits, so 3 other spellings decoded to the same MAC bytes and verified.
    const token = tokenOf(await issuer.download("a.png"));
    const [payload = "", signature = ""] = token.split(".");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(signature.slice(-1));
    expect(await verifyLocalTicket(token, key)).toEqual({ op: "download", name: "a.png" });
    for (const flip of [1, 2, 3]) {
      const respelled = `${payload}.${signature.slice(0, -1)}${alphabet[last ^ flip]}`;
      expect(await verifyLocalTicket(respelled, key), respelled).toBeUndefined();
    }
  });
});
