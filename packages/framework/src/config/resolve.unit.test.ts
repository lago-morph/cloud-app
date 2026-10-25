import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { createDeployment } from "../core/identity.js";
import { configBoolean, configInteger, configString, configStringList, type ConfigDeclaration } from "./public.js";
import { resolveConfig } from "./resolve.js";
import type { StageConfigFile } from "./schema.js";

const FILE = "config/cloudflare/prod.json";
const prod = createDeployment({ app: "notes", stage: "prod", target: "cloudflare" });

const declaration = {
  title: configString(),
  pageSize: configInteger({ default: 20 }),
  signupOpen: configBoolean({ default: false }),
  tags: configStringList({ default: [] }),
} satisfies ConfigDeclaration;

function values(v: Record<string, StageConfigFile["values"][string]>, framework: StageConfigFile["framework"] = { admins: [] }): StageConfigFile {
  return { values: v, framework };
}

function resolve(config: StageConfigFile, decl: ConfigDeclaration = declaration, secrets: readonly string[] = []) {
  return resolveConfig({ deployment: prod, declaration: decl, secrets, file: FILE, config });
}

function failure(fn: () => unknown): FrameworkError {
  try {
    fn();
  } catch (err) {
    if (err instanceof FrameworkError) return err;
    throw err;
  }
  throw new Error("expected the build to fail");
}

describe("build-time resolution: values (CFG-REQ-001, CFG-REQ-002)", () => {
  it("committed values override defaults; omitted keys with defaults take the default", () => {
    const resolved = resolve(values({ title: "Notes", pageSize: 50 }));
    expect(resolved.values).toEqual({ title: "Notes", pageSize: 50, signupOpen: false, tags: [] });
  });

  it(tag("CFG-AC-002", "a missing value for a key without a default fails the build, naming the key"), () => {
    const err = failure(() => resolve(values({})));
    expect(err.code).toBe("CORE.MISCONFIGURED");
    expect(err.message).toContain(FILE);
    expect(err.message).toContain('"title"');
    expect(err.message).toContain("missing");
  });

  it.each([
    ["title", 3, "a string"],
    ["pageSize", "20", "an integer"],
    ["signupOpen", "yes", "a boolean"],
    ["tags", "a", "a list of strings"],
    ["title", ["a"], "a string"],
  ])(tag("CFG-AC-002", "a wrong-type value for %s fails the build, naming the key"), (key, value, expected) => {
    const err = failure(() => resolve(values({ title: "Notes", [key]: value })));
    expect(err.message).toContain(`"${key}"`);
    expect(err.message).toContain(`must be ${expected}`);
  });

  it(tag("CFG-AC-002", "a value for an undeclared key fails the build, naming the key"), () => {
    const err = failure(() => resolve(values({ title: "Notes", colour: "red" })));
    expect(err.message).toContain('"colour"');
    expect(err.message).toContain("not declared");
  });

  it("lists every problem in one failure", () => {
    const err = failure(() => resolve(values({ pageSize: "x", colour: "red" })));
    expect(err.message).toContain('"title"');
    expect(err.message).toContain('"pageSize"');
    expect(err.message).toContain('"colour"');
  });

  it("a default of the wrong type fails the build, naming the key", () => {
    const err = failure(() => resolve(values({}), { limit: configInteger({ default: 1.5 }) }));
    expect(err.message).toContain('"limit"');
    expect(err.message).toContain("default");
  });

  it.each(["Title", "page_size", "page-size", "1st"])("a declared key named %s (not lowerCamelCase) fails the build", (name) => {
    const err = failure(() => resolve(values({}), { [name]: configString({ default: "x" }) }));
    expect(err.message).toContain(`"${name}"`);
    expect(err.message).toContain("lowerCamelCase");
  });

  it("resolved values are frozen", () => {
    const resolved = resolve(values({ title: "Notes", tags: ["a"] }));
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.values)).toBe(true);
    expect(Object.isFrozen(resolved.values["tags"])).toBe(true);
  });
});

describe("build-time resolution: framework settings (CFG-REQ-005)", () => {
  it("admins and users come from framework.admins and framework.users", () => {
    const resolved = resolve(values({ title: "t" }, { admins: ["google:1"], users: ["google:2"] }));
    expect(resolved.admins).toEqual(["google:1"]);
    expect(resolved.users).toEqual(["google:2"]);
  });

  it("without framework.users there is no users list", () => {
    const resolved = resolve(values({ title: "t" }));
    expect(resolved.admins).toEqual([]);
    expect("users" in resolved).toBe(false);
  });

  it("framework.email is optional and carries only the sender's display name (MAIL-REQ-003)", () => {
    expect("email" in resolve(values({ title: "t" }))).toBe(false);
    expect(resolve(values({ title: "t" }, { admins: [], email: { senderName: "Notes" } })).email).toEqual({ senderName: "Notes" });
    expect(resolve(values({ title: "t" }, { admins: [], email: {} })).email).toEqual({});
  });
});

describe("build-time resolution: identity and secrets (CFG-REQ-004)", () => {
  it("records the deployment identity", () => {
    expect(resolve(values({ title: "t" })).deployment).toEqual({ app: "notes", stage: "prod", target: "cloudflare", isTestStage: false });
  });

  it(tag("CFG-AC-004", "the resolved configuration lists every declared secret with its target location"), () => {
    const resolved = resolve(values({ title: "t" }), declaration, ["apiKey", "smtpPassword"]);
    expect(resolved.secrets).toEqual([
      { name: "apiKey", location: "SECRET_API_KEY" },
      { name: "smtpPassword", location: "SECRET_SMTP_PASSWORD" },
    ]);
  });
});
