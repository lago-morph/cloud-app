import type { Services } from "@lago-morph/prototype-framework";

/** The services a shared case runs with (the same in-process and through `POST /api/cases/run`). */
export type CaseServices = Pick<Services, "sql" | "kv" | "files" | "log">;

/** One case: returns a JSON-serialisable value, `undefined`, or throws (the error is the result). */
export type Case = (services: CaseServices, input: unknown) => Promise<unknown>;

/** Named cases of one set. */
export type CaseSet = Readonly<Record<string, Case>>;

/** Named case sets. */
export type CaseSets = Readonly<Record<string, CaseSet>>;
