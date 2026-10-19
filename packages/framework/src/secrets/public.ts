/**
 * SEC public names (contract: docs/contracts/ts/secrets.d.ts). Types only.
 * Written by B-01; the implementation is B-10's.
 */

export interface SecretsService<S extends string> {
  /**
   * Value of a declared secret. Throws SEC.UNDECLARED for an undeclared name and
   * SEC.MISSING when the stage has no value for it.
   */
  get(name: S): Promise<string>;
}
