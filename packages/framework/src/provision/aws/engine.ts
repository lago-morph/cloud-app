/**
 * The Aurora engine check (PAR-110, PAR-212; provisioning.md PROV-REQ-002 step 1 and §2 "State
 * home"; aws.md "Deploy mechanics" `setupAccount`). Read only.
 *
 * A region passes when it offers an Aurora PostgreSQL 17.x engine version that:
 * - is `available` (RDS `DescribeDBEngineVersions`);
 * - has Aurora Serverless v2 with a minimum capacity of 0 ACU (`ServerlessV2FeaturesSupport.MinCapacity`
 *   ≤ PAR-212's minimum, so the cluster can pause when idle);
 * - supports the Data API on Serverless v2 (`DescribeOrderableDBInstanceOptions` for
 *   `db.serverless` with `SupportsHttpEndpoint`).
 * The highest such minor is PAR-110's resolved value for that region. Which fields AWS
 * populates is unverified until phase L (L-0 resolves PAR-110 in us-east-1).
 */
import { DescribeDBEngineVersionsCommand, DescribeOrderableDBInstanceOptionsCommand, type DBEngineVersion, type RDSClient } from "@aws-sdk/client-rds";
import { describeAwsError } from "./environment.js";

/** The Aurora engine (PAR-110). */
export const ENGINE = "aurora-postgresql";
/** PAR-110's major version. */
export const ENGINE_MAJOR = "17";
/** PAR-212's minimum capacity, in ACU. */
export const MIN_CAPACITY_ACU = 0;
/** The instance class of Aurora Serverless v2. */
export const SERVERLESS_INSTANCE_CLASS = "db.serverless";

export type EngineCheck = { readonly ok: true; readonly version: string } | { readonly ok: false; readonly problem: string };

/** Numeric comparison of dotted versions (`17.10` > `17.9`). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function engineVersions(rds: RDSClient): Promise<DBEngineVersion[]> {
  const all: DBEngineVersion[] = [];
  let marker: string | undefined;
  do {
    const page = await rds.send(new DescribeDBEngineVersionsCommand({ Engine: ENGINE, ...(marker === undefined ? {} : { Marker: marker }) }));
    all.push(...(page.DBEngineVersions ?? []));
    marker = page.Marker;
  } while (marker);
  return all;
}

async function supportsDataApi(rds: RDSClient, version: string): Promise<boolean> {
  let marker: string | undefined;
  do {
    const page = await rds.send(
      new DescribeOrderableDBInstanceOptionsCommand({
        Engine: ENGINE,
        EngineVersion: version,
        DBInstanceClass: SERVERLESS_INSTANCE_CLASS,
        ...(marker === undefined ? {} : { Marker: marker }),
      }),
    );
    if ((page.OrderableDBInstanceOptions ?? []).some((o) => o.SupportsHttpEndpoint === true)) return true;
    marker = page.Marker;
  } while (marker);
  return false;
}

const isMajor = (v: DBEngineVersion): v is DBEngineVersion & { EngineVersion: string } =>
  typeof v.EngineVersion === "string" && v.EngineVersion.split(".")[0] === ENGINE_MAJOR && (v.Status === undefined || v.Status === "available");

/**
 * Checks that `region` (the client's) offers PAR-110 with the Data API and a 0 ACU minimum, and
 * returns the highest passing minor. Never throws for a failing region: the problem says why.
 */
export async function checkEngine(rds: RDSClient, region: string): Promise<EngineCheck> {
  const requirement = `Aurora PostgreSQL ${ENGINE_MAJOR}.x (PAR-110) with the Data API and a ${MIN_CAPACITY_ACU} ACU minimum capacity (PAR-212)`;
  try {
    const candidates = (await engineVersions(rds)).filter(isMajor).sort((a, b) => compareVersions(b.EngineVersion, a.EngineVersion));
    if (candidates.length === 0) return { ok: false, problem: `region ${region} does not offer ${requirement}: no ${ENGINE_MAJOR}.x engine version is available there` };
    const rejected: string[] = [];
    for (const candidate of candidates) {
      const min = candidate.ServerlessV2FeaturesSupport?.MinCapacity;
      if (min === undefined || min > MIN_CAPACITY_ACU) {
        rejected.push(`${candidate.EngineVersion} (minimum ${min === undefined ? "unknown" : `${min} ACU`})`);
        continue;
      }
      if (!(await supportsDataApi(rds, candidate.EngineVersion))) {
        rejected.push(`${candidate.EngineVersion} (no Data API on ${SERVERLESS_INSTANCE_CLASS})`);
        continue;
      }
      return { ok: true, version: candidate.EngineVersion };
    }
    return { ok: false, problem: `region ${region} does not offer ${requirement}; versions offered: ${rejected.join(", ")}` };
  } catch (error) {
    return { ok: false, problem: `checking ${requirement} in region ${region} failed: ${describeAwsError(error)}` };
  }
}
