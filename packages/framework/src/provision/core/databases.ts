/**
 * Stage database names and discovery (migrations.md §2; PROV-REQ-002 step 2). A stage's
 * databases are found by exact match on `^<app>-<stage>-db-(\d+)$`; app names contain no
 * hyphens (PAR-290), so the match is unambiguous. Never a `<app>-<stage>-*` wildcard.
 */
import type { ListedDatabase, Stage, StageDatabase } from "./operations.js";

export function databaseName(stage: Stage, n: number): string {
  return `${stage.app}-${stage.stage}-db-${n}`;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The stage's databases among `listed`, lowest number first (the first one is current). */
export function matchStageDatabases(stage: Stage, listed: readonly ListedDatabase[]): StageDatabase[] {
  const pattern = new RegExp(`^${escape(stage.app)}-${escape(stage.stage)}-db-(\\d+)$`);
  const found: StageDatabase[] = [];
  for (const db of listed) {
    const m = pattern.exec(db.name);
    if (m) found.push({ name: db.name, number: Number(m[1]), id: db.id });
  }
  return found.sort((a, b) => a.number - b.number);
}

export function nextDatabaseName(stage: Stage, current: StageDatabase): string {
  return databaseName(stage, current.number + 1);
}
