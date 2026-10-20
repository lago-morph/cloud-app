import { z, type CurrentUser, type KvService } from "@lago-morph/prototype-framework";

export const DEFAULT_PAGE_SIZE = 10;
export const pageSizeSchema = z.number().int().min(1).max(50);

/** The KV key of a user's posts-per-page choice (DEMO-REQ-005). */
export function pageSizeKey(userId: string): string {
  return `pref:${userId}:pageSize`;
}

/** The user's stored posts-per-page choice, or the default (also for anonymous visitors). */
export async function pageSizeFor(kv: KvService, user: CurrentUser): Promise<number> {
  if (user.level === "anonymous") return DEFAULT_PAGE_SIZE;
  const stored = await kv.get(pageSizeKey(user.id));
  if (stored === null) return DEFAULT_PAGE_SIZE;
  const parsed = pageSizeSchema.safeParse(Number(stored));
  return parsed.success ? parsed.data : DEFAULT_PAGE_SIZE;
}
