import type { AppEnv } from "@lago-morph/prototype-framework";

/** Non-secret configuration keys: none. The Sessionize feed codes are in `sessionize.ts`. */
export const config = {};

/** Secret names: none (the Sessionize feeds are public). */
export const secrets = [] as const;

/** The Hono environment every route module takes: `Hono<Env>`. */
export type Env = AppEnv<typeof config, (typeof secrets)[number]>;
