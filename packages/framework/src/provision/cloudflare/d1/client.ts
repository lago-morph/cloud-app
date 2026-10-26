/**
 * The D1 HTTP API as the CLI uses it (DEC-0093, DEC-0094, DEC-0097): create, list and delete
 * databases, and run one atomic `/query` batch. Every request goes through D-03's `CloudflareApi`
 * (authentication and proxy are its concern; this module never sees a credential).
 *
 * Outcome rule (DEC-0094): only a JSON 4xx answer with `success: false` means "refused, nothing
 * applied" (`rejected`). Any other failure — a 5xx, a non-JSON body, a thrown request (timeout,
 * reset) — is `ambiguous`: the request may have been applied, and the caller must read state
 * before deciding.
 */
import type { CloudflareApi } from "../account.js";
import type { ListedDatabase } from "../../core/operations.js";

/** One statement of a `/query` batch. Values are strings, finite numbers (bound as REAL) or null. */
export interface D1Statement {
  readonly sql: string;
  readonly params?: readonly (string | number | null)[];
}

export type D1Row = Record<string, unknown>;

export class D1RequestError extends Error {
  override readonly name = "D1RequestError";
  constructor(
    message: string,
    /** `rejected`: D1 refused the request and applied nothing. `ambiguous`: it may have been applied. */
    readonly kind: "rejected" | "ambiguous",
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message);
  }
}

/** Cloudflare's error code for "System limit reached: databases per account" (PAR-219, DEC-0097). */
export const DATABASE_LIMIT_CODE = 7406;

interface Envelope {
  success?: unknown;
  result?: unknown;
  result_info?: { total_count?: unknown; total_pages?: unknown };
  errors?: { code?: unknown; message?: unknown }[];
}

const isObject = (v: unknown): v is Envelope => typeof v === "object" && v !== null && !Array.isArray(v);

export interface D1Client {
  /** Creates a database; returns its UUID. */
  create(name: string): Promise<string>;
  /** Every database of the account (all pages). */
  list(name?: string): Promise<ListedDatabase[]>;
  /** Deletes a database. An unknown UUID (404) counts as already deleted. */
  delete(uuid: string): Promise<void>;
  /** Runs the statements as one atomic request; returns each statement's rows. */
  batch(uuid: string, statements: readonly D1Statement[]): Promise<D1Row[][]>;
  /**
   * One request to the database's export or import endpoint (`POST …/database/<uuid>/export`,
   * `…/import`; DEC-0545); returns the answer's `result`. Same outcome rule as the others.
   */
  dumpAction(what: string, uuid: string, endpoint: "export" | "import", body: unknown): Promise<unknown>;
}

const PER_PAGE = 100;

export function d1Client(api: CloudflareApi, accountId: string): D1Client {
  const base = `/accounts/${accountId}/d1/database`;

  async function call(what: string, method: Parameters<CloudflareApi>[0], path: string, body?: unknown): Promise<Envelope> {
    let r: { status: number; body: unknown };
    try {
      r = await api(method, path, body);
    } catch (error) {
      throw new D1RequestError(`${what}: no answer from the D1 API (${error instanceof Error ? error.message : String(error)}); it may have been applied`, "ambiguous");
    }
    const b = r.body;
    if (r.status >= 200 && r.status < 300 && isObject(b) && b.success === true) return b;
    const first = isObject(b) && Array.isArray(b.errors) ? b.errors[0] : undefined;
    const code = typeof first?.code === "number" ? first.code : undefined;
    const detail = first ? `${String(first.message ?? "")}${code !== undefined ? ` (code ${code})` : ""}` : isObject(b) ? "no error detail" : "non-JSON answer";
    if (r.status >= 400 && r.status < 500 && isObject(b) && b.success === false) {
      throw new D1RequestError(`${what} was refused: HTTP ${r.status}: ${detail}`, "rejected", r.status, code);
    }
    throw new D1RequestError(`${what}: unclear answer HTTP ${r.status}: ${detail}; it may have been applied`, "ambiguous", r.status, code);
  }

  return {
    async create(name) {
      const b = await call(`creating D1 database ${name}`, "POST", base, { name });
      const uuid = (b.result as { uuid?: unknown } | null)?.uuid;
      if (typeof uuid !== "string") throw new D1RequestError(`creating D1 database ${name}: the answer has no uuid`, "ambiguous");
      return uuid;
    },
    async list(name) {
      const out: ListedDatabase[] = [];
      for (let page = 1; ; page += 1) {
        const query = `?page=${page}&per_page=${PER_PAGE}${name === undefined ? "" : `&name=${encodeURIComponent(name)}`}`;
        const b = await call("listing D1 databases", "GET", base + query);
        const rows = Array.isArray(b.result) ? (b.result as { uuid?: unknown; name?: unknown }[]) : [];
        for (const row of rows) if (typeof row.uuid === "string" && typeof row.name === "string") out.push({ name: row.name, id: row.uuid });
        if (rows.length < PER_PAGE) return out;
      }
    },
    async delete(uuid) {
      try {
        await call(`deleting D1 database ${uuid}`, "DELETE", `${base}/${uuid}`);
      } catch (error) {
        if (error instanceof D1RequestError && error.status === 404) return;
        throw error;
      }
    },
    async batch(uuid, statements) {
      const b = await call("D1 query", "POST", `${base}/${uuid}/query`, { batch: statements.map((s) => (s.params ? { sql: s.sql, params: s.params } : { sql: s.sql })) });
      const result = Array.isArray(b.result) ? (b.result as { results?: unknown }[]) : [];
      return result.map((r) => (Array.isArray(r.results) ? (r.results as D1Row[]) : []));
    },
    async dumpAction(what, uuid, endpoint, body) {
      return (await call(what, "POST", `${base}/${uuid}/${endpoint}`, body)).result;
    },
  };
}
