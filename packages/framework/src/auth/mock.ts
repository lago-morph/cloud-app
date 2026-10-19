/**
 * Authentication mock (AUTH-REQ-009, auth.md §2 "Provider per stage"): lets local development and
 * test stages choose any identity without a real provider, through `POST /api/auth/mock-login`
 * (framework.openapi.yaml, `x-test-stage-only`). The user ID is used as given, not derived, and
 * the chosen level is used directly (no admin or users list). Installed by the target runtime
 * only locally and on test stages (`checkAuthSettings` refuses it elsewhere); production entry
 * points never import this module (CORE-REQ-006).
 */
import type { Hono } from "hono";
import { z } from "zod";
import type { RuntimeContext, RuntimeEnv } from "../core/assemble.js";
import { jsonBody } from "../http/validation.js";
import { MOCK_DEFAULT_IDS } from "./mock-ids.js";
import type { CurrentUser } from "./public.js";
import type { SessionData } from "./session.js";

/** What AUTH's runtime lends the mock's route. */
export interface MockSessionTools {
  /** Set-Cookie value for a new session holding `data`. */
  issue(c: RuntimeContext, data: SessionData): Promise<string>;
  /** Set-Cookie value that clears the session. */
  clear(): string;
}

export interface AuthMock {
  /** `createTestApp`'s fixed identity (`user` option, `as`): when it returns a user, that user is used directly. */
  readonly fixedUser: (c: RuntimeContext) => CurrentUser | undefined;
  readonly registerRoutes: (api: Hono<RuntimeEnv>, tools: MockSessionTools) => void;
}

export interface AuthMockOptions {
  readonly fixedUser?: (c: RuntimeContext) => CurrentUser | undefined;
}

/** The mock-login request body of framework.openapi.yaml. */
const mockLoginBody = z.strictObject({
  level: z.enum(["anonymous", "user", "admin"]),
  id: z.string().min(1).optional(),
  displayName: z.string().nullable().optional(),
});

export function createAuthMock(options: AuthMockOptions = {}): AuthMock {
  return Object.freeze({
    fixedUser: options.fixedUser ?? (() => undefined),
    registerRoutes: (api: Hono<RuntimeEnv>, tools: MockSessionTools) => {
      api.post("/auth/mock-login", jsonBody(mockLoginBody), async (c) => {
        const body = c.req.valid("json");
        if (body.level === "anonymous") {
          c.header("Set-Cookie", tools.clear(), { append: true });
        } else {
          const data: SessionData = { id: body.id ?? MOCK_DEFAULT_IDS[body.level], displayName: body.displayName ?? null, mockLevel: body.level };
          c.header("Set-Cookie", await tools.issue(c, data), { append: true });
        }
        return c.body(null, 204);
      });
    },
  });
}
