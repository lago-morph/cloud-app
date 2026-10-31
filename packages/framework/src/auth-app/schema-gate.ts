/**
 * Applies the auth app's schema once per isolate and database (DEC-0656). Concurrent callers share
 * one attempt; a failed attempt is forgotten, so the next call tries again.
 */
export function createSchemaGate<D extends object>(apply: (db: D) => Promise<void>): (db: D) => Promise<void> {
  const ready = new WeakMap<D, Promise<void>>();
  return (db) => {
    let p = ready.get(db);
    if (p === undefined) {
      p = apply(db).catch((e: unknown) => {
        ready.delete(db);
        throw e;
      });
      ready.set(db, p);
    }
    return p;
  };
}
