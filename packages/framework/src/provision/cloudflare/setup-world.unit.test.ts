/** The fake setup world's own rules (root cause 2026-10-31-C-34a-fake-secrets-store-read). No network. */
import { describe, expect, it } from "vitest";
import { ACCOUNT } from "./fake-cloud.test-support.js";
import { BOOTSTRAP, EVERYDAY_V2 } from "./permissions.js";
import { SetupWorld } from "./setup-world.test-support.js";

const named = (list: typeof BOOTSTRAP, name: string) => {
  const found = list.find((x) => x.name === name);
  if (found === undefined) throw new Error(`no permission group ${name}`);
  return found;
};
const STORES = `/accounts/${ACCOUNT}/secrets_store/stores`;
const SECRETS = `${STORES}/store1/secrets`;

describe("the fake setup world's Secrets Store rules: a GET needs Secrets Store Read, any other method Secrets Store Write", () => {
  it("a token holding only Secrets Store Read (the everyday token's group) reads the stores and a store's secrets, and writes nothing", async () => {
    const world = new SetupWorld();
    world.addToken("everyday", "MARKER-read-only-value", "read-only-id", { groups: [named(EVERYDAY_V2, "Secrets Store Read")] });
    const api = world.apiFor("MARKER-read-only-value");
    expect((await api("GET", `${STORES}?per_page=1`)).status).toBe(200);
    expect((await api("GET", SECRETS)).status).toBe(200);
    expect((await api("POST", STORES, { name: "another" })).status).toBe(403);
    expect((await api("POST", SECRETS, [{ name: "X", value: "v", scopes: ["workers"] }])).status).toBe(403);
    expect((await api("PUT", `${SECRETS}/some-id`, { value: "v" })).status).toBe(403);
  });

  it("a token holding only Secrets Store Write also reads the stores (Write implies Read)", async () => {
    const world = new SetupWorld();
    world.addToken("everyday", "MARKER-write-only-value", "write-only-id", { groups: [named(BOOTSTRAP, "Secrets Store Write")] });
    expect((await world.apiFor("MARKER-write-only-value")("GET", STORES)).status).toBe(200);
  });
});
