import { describe, expect, it } from "vitest";
import { connectTestStage as implemented } from "./connect.js";
import { connectTestStage } from "./index.js";

describe("./testing exports (testing.d.ts)", () => {
  it("connectTestStage is the smoke connection, not a stub", () => {
    expect(connectTestStage).toBe(implemented);
  });
});
