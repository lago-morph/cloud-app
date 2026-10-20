import { z, type CurrentUser, type KvService } from "@lago-morph/prototype-framework";

export const DEFAULT_PER_PAGE = 10;
export const perPageSchema = z.number().int().min(1).max(50);
const stored = z.object({ perPage: perPageSchema });

/** The KV key of a user's preferences: a fixed prefix plus the trusted user ID. */
export function preferenceKey(userId: string): string {
  return `pref:${userId}`;
}

/** The caller's posts-per-page choice (DEMO-REQ-005), or the default for anonymous callers and unset or unreadable values. */
export async function readPerPage(kv: KvService, user: CurrentUser): Promise<number> {
  if (user.level === "anonymous") return DEFAULT_PER_PAGE;
  const raw = await kv.get(preferenceKey(user.id));
  if (raw === null) return DEFAULT_PER_PAGE;
  try {
    const parsed = stored.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.perPage : DEFAULT_PER_PAGE;
  } catch {
    return DEFAULT_PER_PAGE;
  }
}

export async function writePerPage(kv: KvService, userId: string, perPage: number): Promise<void> {
  await kv.put(preferenceKey(userId), JSON.stringify({ perPage }));
}
