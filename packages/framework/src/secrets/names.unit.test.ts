import { describe, expect, it } from "vitest";
import { secretLocation } from "../config/secret-locations.js";
import { DEV_GENERATED_SECRETS, LOCAL_FRAMEWORK_SECRETS, LOCAL_TICKET_KEY } from "./local-names.js";
import { checkSecretDeclarations, FRAMEWORK_SECRETS, isReservedSecretName } from "./names.js";

describe("framework-internal secret names (secrets.md §2, DEC-0064)", () => {
  it("names the session key, Google client secret and R2 credentials; the local ticket key is in a local-only module", () => {
    expect(FRAMEWORK_SECRETS).toEqual({
      sessionKey: "frameworkSessionKey",
      googleClientSecret: "frameworkGoogleClientSecret",
      r2AccessKeyId: "frameworkR2AccessKeyId",
      r2SecretAccessKey: "frameworkR2SecretAccessKey",
    });
    // CORE-REQ-006: names.ts is in every cloud bundle; the local ticket key's name must not be.
    expect(LOCAL_TICKET_KEY).toBe("frameworkLocalTicketKey");
    expect(LOCAL_FRAMEWORK_SECRETS).toEqual(["frameworkLocalTicketKey"]);
  });

  it("every framework-internal name uses the reserved prefix", () => {
    for (const name of [...Object.values(FRAMEWORK_SECRETS), ...LOCAL_FRAMEWORK_SECRETS]) expect(isReservedSecretName(name), name).toBe(true);
    expect(isReservedSecretName("apiKey")).toBe(false);
  });

  it("the Google client secret is stored at SECRET_FRAMEWORK_GOOGLE_CLIENT_SECRET (as GOOGLE expects)", () => {
    expect(secretLocation("local", FRAMEWORK_SECRETS.googleClientSecret)).toBe("SECRET_FRAMEWORK_GOOGLE_CLIENT_SECRET");
  });

  it("an app declaration of lowerCamelCase names outside the reserved prefix passes", () => {
    expect(() => checkSecretDeclarations(["apiKey", "smtpPassword", "key2"])).not.toThrow();
  });

  it("an app declaration using the reserved prefix, a non-lowerCamelCase name, or a duplicate fails, listing every problem", () => {
    let failure: unknown;
    try {
      checkSecretDeclarations(["frameworkSessionKey", "api_key", "ApiKey", "apiKey", "apiKey"]);
    } catch (e) {
      failure = e;
    }
    expect(failure).toMatchObject({ name: "FrameworkError", code: "CORE.MISCONFIGURED" });
    const message = (failure as Error).message;
    expect(message).toContain(`secret "frameworkSessionKey" uses the reserved prefix "framework"`);
    expect(message).toContain(`secret "api_key" is not a lowerCamelCase name`);
    expect(message).toContain(`secret "ApiKey" is not a lowerCamelCase name`);
    expect(message).toContain(`secret "apiKey" is declared more than once`);
  });

  it("only the session key and the local ticket key are generated for development", () => {
    expect([...DEV_GENERATED_SECRETS].sort()).toEqual(["frameworkLocalTicketKey", "frameworkSessionKey"]);
  });
});
