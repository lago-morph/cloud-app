/**
 * Type fixtures for the app contract (CORE-AC-001, unit form). The assertions are checked by
 * `npm run typecheck`, which compiles this file; the fixture functions are never called, because
 * the config key constructors belong to CFG and need not run here.
 */
import type { Hono } from "hono";
import { describe, expect, expectTypeOf, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import {
  configInteger,
  configString,
  defineApp,
  type AppEnv,
  type DeploymentIdentity,
  type RequestVars,
} from "../index.js";

/** App using only `.` exports, with routes inline. */
function inlineFixture() {
  return defineApp({
    name: "notes",
    config: { title: configString(), limit: configInteger({ default: 10 }) },
    secrets: ["apiKey"],
    tables: {},
    routes: (api) => {
      api.get("/vars", async (c) => {
        expectTypeOf<keyof typeof c.var>().toEqualTypeOf<keyof RequestVars>();
        expectTypeOf(c.var.deployment).toEqualTypeOf<DeploymentIdentity>();
        expectTypeOf(c.var.requestId).toEqualTypeOf<string>();
        expectTypeOf(c.var.config.get("limit")).toEqualTypeOf<number>();
        expectTypeOf(c.var.config.get("title")).toEqualTypeOf<string>();
        expectTypeOf(await c.var.secrets.get("apiKey")).toEqualTypeOf<string>();
        // @ts-expect-error undeclared secret name
        void c.var.secrets.get("other");
        // @ts-expect-error undeclared config key
        void c.var.config.get("missing");
        // @ts-expect-error the target is not visible to app code (CORE-REQ-003)
        void c.var.deployment.target;
        // @ts-expect-error platform bindings are not visible through c.env
        void c.env.DB;
        return c.json({ ok: true });
      });
    },
  });
}

/** Routes in a separate "file": a function typed against the app's config declaration. */
const separateConfig = () => ({ limit: configInteger() });
type Env = AppEnv<ReturnType<typeof separateConfig>, "apiKey">;
function separateRoutes(api: Hono<Env>): void {
  api.get("/limit", (c) => {
    const limit: number = c.var.config.get("limit");
    // @ts-expect-error a wrong config value type fails type checking
    const wrong: string = c.var.config.get("limit");
    return c.json({ limit, wrong });
  });
}
function separateFixture() {
  return defineApp({ name: "notes", config: separateConfig(), secrets: ["apiKey"], tables: {}, routes: separateRoutes });
}

describe("app contract type fixtures", () => {
  it(tag("CORE-AC-001", "c.var and config value types (checked by npm run typecheck)"), () => {
    expect(typeof inlineFixture).toBe("function");
    expect(typeof separateFixture).toBe("function");
  });
});
