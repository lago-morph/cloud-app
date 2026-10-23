import { describe, expect, expectTypeOf, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { createDeployment } from "../core/identity.js";
import { configBoolean, configInteger, configString, configStringList, type ConfigService } from "./public.js";
import { resolveConfig } from "./resolve.js";
import { createConfigService } from "./service.js";

const declaration = {
  title: configString(),
  pageSize: configInteger({ default: 20 }),
  signupOpen: configBoolean({ default: true }),
  tags: configStringList({ default: ["x"] }),
};

const resolved = resolveConfig({
  deployment: createDeployment({ app: "notes", stage: "dev", target: "local" }),
  declaration,
  secrets: [],
  file: "config/local.json",
  config: { values: { title: "Notes", tags: ["a", "b"] }, framework: { admins: [] } },
});

describe("ConfigService (CFG-REQ-001, CFG-REQ-003)", () => {
  const config: ConfigService<typeof declaration> = createConfigService<typeof declaration>(resolved);

  it(tag("CFG-AC-001", "declared keys read with their typed values and defaults"), () => {
    expect(config.get("title")).toBe("Notes");
    expect(config.get("pageSize")).toBe(20);
    expect(config.get("signupOpen")).toBe(true);
    expect(config.get("tags")).toEqual(["a", "b"]);
    expectTypeOf(config.get("title")).toEqualTypeOf<string>();
    expectTypeOf(config.get("pageSize")).toEqualTypeOf<number>();
    expectTypeOf(config.get("signupOpen")).toEqualTypeOf<boolean>();
    expectTypeOf(config.get("tags")).toEqualTypeOf<readonly string[]>();
    // An undeclared key is also a type error (checked by `npm run typecheck`).
    // @ts-expect-error "colour" is not declared
    expect(() => config.get("colour")).toThrow(FrameworkError);
  });

  it(tag("CFG-AC-001", "reading an undeclared key fails with CFG.UNDECLARED_KEY naming the key"), () => {
    let err: unknown;
    try {
      // App code that bypasses the types (e.g. a key name built at run time).
      (config as unknown as ConfigService<Record<string, never>>).get("colour" as never);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FrameworkError);
    expect((err as FrameworkError).code).toBe("CFG.UNDECLARED_KEY");
    expect((err as FrameworkError).message).toContain('"colour"');
  });

  it("does not treat inherited object properties as declared keys", () => {
    expect(() => (config as unknown as ConfigService<Record<string, never>>).get("toString" as never)).toThrow(FrameworkError);
  });

  it("values are read-only at runtime", () => {
    const tags = config.get("tags") as string[];
    expect(() => tags.push("c")).toThrow(TypeError);
    expect(config.get("tags")).toEqual(["a", "b"]);
    expect(Object.keys(config)).toEqual(["get"]);
    expect(Object.isFrozen(config)).toBe(true);
  });
});
