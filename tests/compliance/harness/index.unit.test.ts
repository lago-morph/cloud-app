import { describe, expect, it } from "vitest";
import { newTestStage } from "./index.js";

describe("[COMPL-AC-004] further stages for stage-lifecycle criteria", () => {
  it("are test-<random run ID> of the specified form, and differ", () => {
    const a = newTestStage();
    const b = newTestStage();
    expect(a).toMatch(/^test-[a-z0-9]{15}$/);
    expect(a).not.toBe(b);
  });
});
