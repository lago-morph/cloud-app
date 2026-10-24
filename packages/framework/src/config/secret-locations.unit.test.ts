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

  it("AWS stores secret <name> as the SSM parameter /<app>/<stage>/secrets/<name>, with the logical name unchanged", () => {
    expect(secretLocation("aws", "apiKey", { app: "notes", stage: "test-ab1" })).toBe("/notes/test-ab1/secrets/apiKey");
    expect(secretLocation("aws", "frameworkSessionKey", { app: "notes", stage: "prod" })).toBe("/notes/prod/secrets/frameworkSessionKey");
  });

  it("the env-backed targets ignore the app and stage", () => {
    expect(secretLocation("cloudflare", "apiKey", { app: "notes", stage: "prod" })).toBe("SECRET_API_KEY");
  });

  it("an AWS location without the app and stage is a programming error, not a guess", () => {
    expect(() => (secretLocation as (t: string, n: string) => string)("aws", "apiKey")).toThrow(/app and stage/);
  });
});
