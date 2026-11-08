// Unit tests for the live-pass records: the snapshot diff after each step, who is the owner and
// who the tester, and the upload of scrubbed record files to the records bucket.
// Written from the brief: an API snapshot before and after each phase; records may hold both
// people's emails and Cloudflare user IDs; everything is uploaded to the records bucket.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { memoryStore } from "./lib/checkpoint.mjs";
import { createRecorder } from "./lib/records.mjs";
import { createScrubber } from "./lib/scrub.mjs";
import { diffSnapshots } from "./lib/snapshot.mjs";
import { people } from "./lib/steps.mjs";

const snap = (over: Record<string, unknown> = {}) => ({
  workers: { ok: true, items: [{ name: "prototype-admin", modified_on: "t1", bindings: [], observability: null, secretNames: [], compatibility_flags: ["nodejs_compat"] }] },
  d1: { ok: true, items: [] },
  r2: { ok: true, items: [{ name: "prototype-logs", objects: [], lifecycle: null, cors: null }] },
  secretsStore: { ok: true, items: [{ id: "s1", name: "prototype-framework", secrets: [{ id: "x", name: "PROTOTYPE_ADMIN_CLIENT_ID", comment: "c1" }] }] },
  tokens: { ok: true, items: [{ id: "t1", name: "live-pass-admin", status: "active", policies: [] }] },
  members: { ok: true, items: [] },
  oauthClients: { ok: true, items: [] },
  subdomain: { ok: true, subdomain: "sub" },
  ...over,
});

describe("diffSnapshots", () => {
  it("lists what was added, removed and changed", () => {
    const before = snap();
    const after = snap({
      workers: { ok: true, items: [{ name: "prototype-admin", modified_on: "t2", bindings: [], observability: null, secretNames: [], compatibility_flags: ["nodejs_compat"] }, { name: "prototype-auth", modified_on: "t2", bindings: [] }] },
      tokens: { ok: true, items: [] },
    });
    expect(diffSnapshots(before, after)).toEqual({ added: ["worker:prototype-auth"], removed: ["token:live-pass-admin#t1"], changed: ["worker:prototype-admin"] });
  });

  it("is empty for the same account state", () => {
    expect(diffSnapshots(snap(), snap())).toEqual({ added: [], removed: [], changed: [] });
  });

  it("treats a missing previous snapshot as everything added", () => {
    expect(diffSnapshots(null, snap()).added).toContain("worker:prototype-admin");
  });

  it("ignores a section that could not be read rather than reporting its items removed", () => {
    const after = snap({ tokens: { ok: false, error: "HTTP 403" } });
    const d = diffSnapshots(snap(), after);
    expect(d.removed).toEqual([]);
    expect(d.unreadable).toEqual(["tokens"]);
  });
});

describe("people", () => {
  const member = (email: string, roles: string[], status = "accepted") => ({ id: `m-${email}`, email, userId: `u-${email}`, status, roles });

  it("finds the owner (Super Administrator) and the one other accepted member as the tester", () => {
    const p = people({ members: { items: [member("owner@x", ["Super Administrator - All Privileges"]), member("tester@x", ["HTTP Applications Read"])] } });
    expect(p.owner?.email).toBe("owner@x");
    expect(p.tester?.email).toBe("tester@x");
  });

  it("has no tester while the invitation is pending, and lists the pending one", () => {
    const p = people({ members: { items: [member("owner@x", ["Super Administrator - All Privileges"]), member("tester@x", ["HTTP Applications Read"], "pending")] } });
    expect(p.tester).toBeUndefined();
    expect(p.pending.map((m: { email: string }) => m.email)).toEqual(["tester@x"]);
  });

  it("has no tester when two other members are accepted (ambiguous)", () => {
    const p = people({ members: { items: [member("owner@x", ["Super Administrator - All Privileges"]), member("a@x", ["Analytics"]), member("b@x", ["Analytics"])] } });
    expect(p.tester).toBeUndefined();
  });
});

describe("createRecorder", () => {
  it("writes scrubbed files and uploads only what changed since the last sync", async () => {
    const store = memoryStore();
    const dir = mkdtempSync(join(tmpdir(), "live-pass-records-"));
    const r = createRecorder({ dir, scrubber: createScrubber([{ name: "T", value: "secret-value-0123456789" }]), store });
    r.json("steps/001-S4.json", { out: "has secret-value-0123456789" });
    r.append("events.jsonl", { e: 1 });
    expect(await r.sync()).toEqual({ uploaded: 2, failed: [] });
    expect(store.objects.get("steps/001-S4.json")).toContain("[REDACTED:T]");
    expect(readFileSync(join(dir, "steps/001-S4.json"), "utf8")).not.toContain("secret-value-0123456789");
    r.append("events.jsonl", { e: 2 });
    expect(await r.sync()).toEqual({ uploaded: 1, failed: [] });
    expect(store.objects.get("events.jsonl")?.trim().split("\n")).toHaveLength(2);
  });

  it("keeps a failed upload for the next sync, also in a new process", async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-pass-records-"));
    const failing = { async put() { throw new Error("HTTP 500"); }, async get() { return null; } };
    const r = createRecorder({ dir, scrubber: createScrubber(), store: failing });
    r.json("a.json", { x: 1 });
    expect((await r.sync()).failed).toEqual(["a.json: HTTP 500"]);
    const store = memoryStore();
    const again = createRecorder({ dir, scrubber: createScrubber(), store });
    expect(await again.sync()).toEqual({ uploaded: 1, failed: [] });
    expect(store.objects.has("a.json")).toBe(true);
  });

  // Review 2026-11-02 (independent test author): a new session, or a reclaimed container, starts
  // with an empty records directory. The run's append-only logs (events, API calls, HTTP calls,
  // Workers Logs settings) must keep what earlier containers uploaded.
  const lines = (body: string | null | undefined) => (body ?? "").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  it("keeps the lines an earlier container uploaded when a new container appends to the same log", async () => {
    const store = memoryStore();
    const first = createRecorder({ dir: mkdtempSync(join(tmpdir(), "live-pass-records-")), scrubber: createScrubber(), store });
    first.append("events.jsonl", { session: 1 });
    first.append("api-calls.jsonl", { call: 1 });
    await first.sync();
    const second = createRecorder({ dir: mkdtempSync(join(tmpdir(), "live-pass-records-")), scrubber: createScrubber(), store });
    second.append("events.jsonl", { session: 2 });
    expect(await second.sync()).toEqual({ uploaded: 1, failed: [] });
    expect(lines(store.objects.get("events.jsonl"))).toEqual([{ session: 1 }, { session: 2 }]);
    second.append("events.jsonl", { session: 2, again: true });
    await second.sync();
    expect(lines(store.objects.get("events.jsonl"))).toEqual([{ session: 1 }, { session: 2 }, { session: 2, again: true }]);
    expect(lines(store.objects.get("api-calls.jsonl"))).toEqual([{ call: 1 }]);
  });

  it("never overwrites a log whose earlier lines it could not read, and uploads it once it can", async () => {
    const store = memoryStore();
    await store.put("events.jsonl", `${JSON.stringify({ session: 1 })}\n`);
    let down = true;
    const flaky = {
      async get(k: string) {
        if (down) throw new Error("HTTP 503");
        return store.get(k);
      },
      async put(k: string, b: string) {
        await store.put(k, b);
      },
    };
    const dir = mkdtempSync(join(tmpdir(), "live-pass-records-"));
    const r = createRecorder({ dir, scrubber: createScrubber(), store: flaky });
    r.append("events.jsonl", { session: 2 });
    expect((await r.sync()).failed).toHaveLength(1);
    expect(lines(store.objects.get("events.jsonl"))).toEqual([{ session: 1 }]);
    down = false;
    const again = createRecorder({ dir, scrubber: createScrubber(), store: flaky });
    expect(await again.sync()).toEqual({ uploaded: 1, failed: [] });
    expect(lines(store.objects.get("events.jsonl"))).toEqual([{ session: 1 }, { session: 2 }]);
  });
});
