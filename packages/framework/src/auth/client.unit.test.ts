import { afterEach, describe, expect, it, vi } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { ApiError } from "../http/client.js";
import { getCurrentUser, login, logout } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser session helpers", () => {
  it(tag("AUTH-AC-001", "getCurrentUser returns the server's user and never passes unlistedId to app code"), async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    fetch.mockResolvedValueOnce(jsonResponse({ level: "user", id: "u_X", displayName: null }));
    expect(await getCurrentUser()).toStrictEqual({ level: "user", id: "u_X", displayName: null });
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/auth/me");
    fetch.mockResolvedValueOnce(jsonResponse({ level: "anonymous", unlistedId: "u_Y" }));
    expect(await getCurrentUser()).toStrictEqual({ level: "anonymous" });
  });

  it("getCurrentUser rejects with ApiError when the API fails", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError("offline")));
    await expect(getCurrentUser()).rejects.toBeInstanceOf(ApiError);
  });

  it("login navigates to /api/auth/login with returnTo, defaulting to the current page", () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { pathname: "/notes/4", search: "?tab=a", hash: "#top", assign });
    login("/after?x=1");
    expect(assign).toHaveBeenLastCalledWith("/api/auth/login?returnTo=%2Fafter%3Fx%3D1");
    login();
    expect(assign).toHaveBeenLastCalledWith("/api/auth/login?returnTo=%2Fnotes%2F4%3Ftab%3Da%23top");
  });

  it("logout POSTs /api/auth/logout and resolves when the session is cleared", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await expect(logout()).resolves.toBeUndefined();
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/auth/logout");
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("POST");
  });
});
