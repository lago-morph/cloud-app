import { describe, expect, it } from "vitest";
import { classifyPath } from "./paths.js";

describe("[CHECK-AC-001] path classification (CHECK-REQ-001)", () => {
  it.each([
    ["src/client/main.ts", "browser"],
    ["src/client/pages/list.tsx", "browser"],
    ["src/server/routes/notes.ts", "server"],
    ["src/app.ts", "server"],
    ["src/shared/types.ts", "shared"],
    ["tests/notes.test.ts", "test"],
    ["tests/smoke/smoke.test.ts", "test"],
    ["src/vite-env.d.ts", "server"],
  ] as const)("%s is %s code", (path, kind) => {
    expect(classifyPath(path)).toBe(kind);
  });

  it("accepts Windows separators", () => {
    expect(classifyPath("src\\client\\main.ts")).toBe("browser");
  });

  it("files outside src/ and tests/ are not app code", () => {
    expect(classifyPath("vite.config.ts")).toBeUndefined();
    expect(classifyPath(".framework/entry.ts")).toBeUndefined();
    expect(classifyPath("../elsewhere/src/client/x.ts")).toBeUndefined();
  });
});
