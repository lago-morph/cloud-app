import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { CLOUD_COOKIES, cookieSettings, clearCookie, readCookie, setCookie } from "./cookies.js";
import { LOCAL_COOKIES } from "./local-cookies.js";

function attributes(line: string): string[] {
  return line.split(";").slice(1).map((a) => a.trim());
}

describe("AUTH cookies", () => {
  it(tag("AUTH-AC-006", "local: session_local and login_local, HttpOnly, SameSite=Lax, Path=/, not Secure"), () => {
    const local = cookieSettings("local", LOCAL_COOKIES);
    expect(local.session).toBe("session_local");
    expect(local.login).toBe("login_local");
    const line = setCookie(local, local.session, "v1", 604800);
    expect(line.startsWith("session_local=v1;")).toBe(true);
    expect(attributes(line)).toStrictEqual(["Path=/", "Max-Age=604800", "HttpOnly", "SameSite=Lax"]);
  });

  it(tag("AUTH-AC-006", "cloud: __Host- names, Secure, Path=/, no Domain"), () => {
    const cloud = cookieSettings("cloudflare");
    expect(cloud.session).toBe("__Host-session");
    expect(cloud.login).toBe("__Host-login");
    const line = setCookie(cloud, cloud.login, "v2", 600);
    expect(attributes(line)).toStrictEqual(["Path=/", "Max-Age=600", "HttpOnly", "SameSite=Lax", "Secure"]);
    expect(line.toLowerCase()).not.toContain("domain");
  });

  it(tag("LOCAL-AC-004", "cloud builds reject the local cookie settings"), () => {
    expect(cookieSettings("local", LOCAL_COOKIES).secure).toBe(false);
    const error = (() => {
      try {
        cookieSettings("cloudflare", LOCAL_COOKIES);
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(FrameworkError);
    expect((error as FrameworkError).code).toBe("CORE.MISCONFIGURED");
  });

  it(tag("LOCAL-AC-004", "the local settings live in a local-only module; without them every target gets the cloud settings"), () => {
    expect(cookieSettings("cloudflare")).toBe(CLOUD_COOKIES);
    expect(cookieSettings("local")).toBe(CLOUD_COOKIES);
    expect(Object.values(CLOUD_COOKIES)).not.toContain("session_local");
  });

  it(tag("AUTH-AC-006", "clearing sets an empty value with Max-Age=0 and the same attributes"), () => {
    const cloud = cookieSettings("cloudflare");
    expect(clearCookie(cloud, cloud.session)).toBe("__Host-session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure");
  });

  it("reads one cookie from a Cookie header", () => {
    expect(readCookie("a=1; session_local=abc.def; b=2", "session_local")).toBe("abc.def");
    expect(readCookie("session_localx=1", "session_local")).toBeUndefined();
    expect(readCookie(undefined, "session_local")).toBeUndefined();
    expect(readCookie("session_local=", "session_local")).toBeUndefined();
    expect(readCookie("x=1;session_local=v", "session_local")).toBe("v");
  });
});
