import type { CaseSets } from "../case-types";
import { kvCases } from "./kv";
import { migCases } from "./mig";
import { sqlCases } from "./sql";

/** C-T2's shared case sets, run by `POST /api/cases/run` (ROUTES.md "Shared case sets"). */
export const caseSets: CaseSets = { sql: sqlCases, kv: kvCases, mig: migCases };
