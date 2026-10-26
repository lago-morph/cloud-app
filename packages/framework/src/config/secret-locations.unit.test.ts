import { describe, expect, it } from "vitest";
import { secretLocation, upperSnake } from "./secret-locations.js";

describe("secret locations by SEC's convention (SEC-REQ-003)", () => {
  it.each([
    ["apiKey", "API_KEY"],
    ["key", "KEY"],
    ["key2", "KEY2"],
    ["frameworkSessionKey", "FRAMEWORK_SESSION_KEY"],
    ["smtpURL", "SMTP_U_R_L"],
  ])("the upper snake case form of %s is %s", (name, expected) => {
    expect(upperSnake(name)).toBe(expected);
  });

  it("local and Cloudflare store secret <name> as SECRET_<NAME>", () => {
    expect(secretLocation("local", "apiKey")).toBe("SECRET_API_KEY");
    expect(secretLocation("cloudflare", "apiKey")).toBe("SECRET_API_KEY");
  });
});
