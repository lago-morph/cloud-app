import { describe, expect, it } from "vitest";
import { originOfPath } from "./resolve.js";

describe("declaration origin by path", () => {
  it("framework files are recognised in the workspace and when installed under node_modules", () => {
    expect(originOfPath("/repo/packages/framework/dist/sql/expressions.d.ts", "/repo/packages/framework")).toBe("framework");
    expect(originOfPath("/app/node_modules/@lago-morph/prototype-framework/dist/index.d.ts", "/app/node_modules/@lago-morph/prototype-framework")).toBe("framework");
  });

  it("the framework's own dependencies are not framework code", () => {
    expect(originOfPath("/app/node_modules/@lago-morph/prototype-framework/node_modules/drizzle-orm/sql/sql.d.ts", "/app/node_modules/@lago-morph/prototype-framework")).toBe("drizzle");
  });

  it("drizzle, hono and app files", () => {
    expect(originOfPath("/repo/node_modules/drizzle-orm/sql/sql.d.ts", "/repo/packages/framework")).toBe("drizzle");
    expect(originOfPath("/repo/node_modules/hono/dist/types/context.d.ts", "/repo/packages/framework")).toBe("hono");
    expect(originOfPath("/tmp/app/src/server/tables.ts", "/repo/packages/framework")).toBe("app");
  });
});
