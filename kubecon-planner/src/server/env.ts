import { configString, type AppEnv } from "@lago-morph/prototype-framework";

/** Non-secret configuration keys; values per stage are in `config/`. */
export const config = {
  greeting: configString({ default: "Hello" }),
};

/** Secret names; values are set with `secrets set <name>`, never committed. */
export const secrets = ["apiKey"] as const;

/** The Hono environment every route module takes: `Hono<Env>`. */
export type Env = AppEnv<typeof config, (typeof secrets)[number]>;
