/** Secrets (SEC). Behavior: docs/components/secrets.md. */

export interface SecretsService<S extends string> {
  /**
   * Value of a declared secret. Throws SEC.UNDECLARED for an undeclared name and
   * SEC.MISSING when the stage has no value for it.
   */
  get(name: S): Promise<string>;
}
