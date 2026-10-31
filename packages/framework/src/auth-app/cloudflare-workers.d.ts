/**
 * The one workerd module the auth app's Worker entry uses (worker.ts). The framework type-checks
 * with Node types only (DEC-0105: @cloudflare/workers-types is never listed), so this declares
 * just the part of `WorkerEntrypoint` it needs. The bundler leaves the import to workerd.
 */
declare module "cloudflare:workers" {
  export abstract class WorkerEntrypoint<Env = unknown> {
    protected readonly ctx: { waitUntil(promise: Promise<unknown>): void };
    protected readonly env: Env;
    constructor(ctx: unknown, env: Env);
  }
}
