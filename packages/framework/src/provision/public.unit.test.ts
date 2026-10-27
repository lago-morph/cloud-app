/** The `./provision` subpath's names that other packages and processes read. */
import { describe, expect, it } from "vitest";
import * as provision from "./public.js";
import { ACCOUNT_SETUP_VERSION, PERMISSIONS_VERSION } from "./cloudflare/permissions.js";

describe("./provision", () => {
  it("exports the local setup the starter runs", () => {
    expect(typeof provision.runLocalSetup).toBe("function");
    expect(typeof provision.describeLocalSetup).toBe("function");
  });

  it("exports PERMISSIONS_VERSION and ACCOUNT_SETUP_VERSION, which `upgrade` reads in a fresh process (plan-setup-wizard §4.8a)", () => {
    const names = provision as Record<string, unknown>;
    expect(names.PERMISSIONS_VERSION).toBe(PERMISSIONS_VERSION);
    expect(names.ACCOUNT_SETUP_VERSION).toBe(ACCOUNT_SETUP_VERSION);
  });
});
