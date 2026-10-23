/**
 * SEC public names (contract: docs/contracts/ts/secrets.d.ts). Types only. Behavior:
 * docs/components/secrets.md. Framework-internal parts: `names.ts` (reserved prefix, internal
 * names, declaration check), `service.ts` (runtime service and readers), `dev-vars.ts` and
 * `local.ts` (the local `.dev.vars` store), `set-command.ts` (`secrets set` arguments and stdin).
 */

export interface SecretsService<S extends string> {
  /**
   * Value of a declared secret. Throws SEC.UNDECLARED for an undeclared name and
   * SEC.MISSING when the stage has no value for it.
   */
  get(name: S): Promise<string>;
}
