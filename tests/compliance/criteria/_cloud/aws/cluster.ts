/**
 * Cluster-paused observer (AWS-AC-005; DEC-PENDING-g-s1-6, PAR-281).
 *
 * Observing a pause must not end it, so the observer uses control-plane reads only and never
 * the Data API:
 * - RDS `DescribeDBClusters` on `<app>-<stage>`: status, the Serverless v2 minimum capacity and
 *   the auto-pause delay, and the member instances. A minimum above 0 ACU means the cluster can
 *   never pause (PAR-212), which is reported at once as the reason. 1 call.
 * - RDS `DescribeEvents` for each member instance over the last `EVENT_WINDOW_MINUTES`: Aurora
 *   publishes an event when a Serverless v2 instance auto-pauses and when it resumes. The latest
 *   pause/resume event of each instance gives its state; the cluster is paused when every member
 *   is. Events are matched by their message ("paus…" / "resum…"), not by event ID, because the IDs
 *   are not named in the docs this item may use (unverified live; phase L confirms the wording).
 *   1 call per member (bounded pages).
 *
 * `waitForClusterPaused` polls every `PAUSE_POLL_MS` (30 s) up to `PAUSE_WAIT_MS` (PAR-281,
 * 15 minutes) and never throws on the bound: it returns `{ paused: false, reason }` with the last
 * observed state, so AWS-AC-005 can be recorded not-run with the reason. At most about 60 calls
 * for a one-instance cluster.
 */
import { DescribeDBClustersCommand, DescribeEventsCommand } from "@aws-sdk/client-rds";
import { awsCall, awsClients, awsFailure, errorName, MAX_PAGES } from "./api.js";
import { type AwsStage, clusterIdentifier } from "./names.js";

/** PAR-281 (proposed): the bound on the wait for an observable pause. */
export const PAUSE_WAIT_MS = 15 * 60_000;
export const PAUSE_POLL_MS = 30_000;
export const EVENT_WINDOW_MINUTES = 60;

export interface PauseObservation {
  readonly state: "paused" | "running" | "never-pauses" | "unknown";
  /** What was observed, for a not-run reason. */
  readonly detail: string;
}

type InstanceState = "paused" | "running" | "none";

/** Classifies one RDS event message as a pause, a resume, or neither. */
export function classifyEventMessage(message: string): "pause" | "resume" | undefined {
  const m = message.toLowerCase();
  if (/\bresum/.test(m)) return "resume";
  if (/\bpaus/.test(m) || /auto-?pause/.test(m)) return "pause";
  return undefined;
}

async function instanceState(instance: string): Promise<{ state: InstanceState; last?: string }> {
  let latest: { date: number; kind: "pause" | "resume"; message: string } | undefined;
  let marker: string | undefined;
  const what = `reading the events of DB instance ${instance}`;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let r;
    try {
      r = await awsCall(what, () =>
        awsClients().rds.send(new DescribeEventsCommand({ SourceIdentifier: instance, SourceType: "db-instance", Duration: EVENT_WINDOW_MINUTES, MaxRecords: 100, ...(marker === undefined ? {} : { Marker: marker }) })),
      );
    } catch (error) {
      throw awsFailure(what, error);
    }
    for (const e of r.Events ?? []) {
      const kind = classifyEventMessage(e.Message ?? "");
      const date = e.Date?.getTime();
      if (kind === undefined || date === undefined) continue;
      if (latest === undefined || date >= latest.date) latest = { date, kind, message: e.Message ?? "" };
    }
    marker = r.Marker;
    if (marker === undefined || marker === "") break;
    if (page === MAX_PAGES - 1) throw new Error(`${what}: more than ${String(MAX_PAGES)} pages; the hook does not read further`);
  }
  if (latest === undefined) return { state: "none" };
  return { state: latest.kind === "pause" ? "paused" : "running", last: `${new Date(latest.date).toISOString()} "${latest.message}"` };
}

/** One observation of the stage cluster's pause state. */
export async function observeClusterPause(s: AwsStage): Promise<PauseObservation> {
  const id = clusterIdentifier(s);
  const what = `reading Aurora cluster ${id}`;
  let cluster;
  try {
    cluster = (await awsCall(what, () => awsClients().rds.send(new DescribeDBClustersCommand({ DBClusterIdentifier: id })))).DBClusters?.[0];
  } catch (error) {
    if (errorName(error) === "DBClusterNotFoundFault") return { state: "unknown", detail: `cluster ${id} does not exist` };
    throw awsFailure(what, error);
  }
  if (cluster === undefined) return { state: "unknown", detail: `cluster ${id} was not returned` };
  const min = cluster.ServerlessV2ScalingConfiguration?.MinCapacity;
  if (min === undefined || min > 0) return { state: "never-pauses", detail: `cluster ${id} has minimum capacity ${String(min ?? "unset")} ACU, so it never pauses (PAR-212 needs 0)` };
  const members = (cluster.DBClusterMembers ?? []).map((m) => m.DBInstanceIdentifier).filter((m): m is string => m !== undefined);
  if (members.length === 0) return { state: "unknown", detail: `cluster ${id} (status ${cluster.Status ?? "unknown"}) has no instances` };
  const states: string[] = [];
  let allPaused = true;
  for (const m of members.sort()) {
    const st = await instanceState(m);
    states.push(`${m}: ${st.state === "none" ? `no pause or resume event in the last ${String(EVENT_WINDOW_MINUTES)} minutes` : `${st.state} (${st.last ?? ""})`}`);
    if (st.state !== "paused") allPaused = false;
  }
  const detail = `cluster ${id} status ${cluster.Status ?? "unknown"}, auto-pause after ${String(cluster.ServerlessV2ScalingConfiguration?.SecondsUntilAutoPause ?? "unset")} s; ${states.join("; ")}`;
  return { state: allPaused ? "paused" : "running", detail };
}

export type PauseWaitResult = { readonly paused: true; readonly detail: string } | { readonly paused: false; readonly reason: string };

export interface PauseWaitOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Waits, bounded by PAR-281, until the cluster is observably paused; never throws on the bound. */
export async function waitForClusterPaused(s: AwsStage, options: PauseWaitOptions = {}): Promise<PauseWaitResult> {
  const timeoutMs = options.timeoutMs ?? PAUSE_WAIT_MS;
  const interval = options.intervalMs ?? PAUSE_POLL_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  let last = "no observation completed";
  for (;;) {
    try {
      const o = await observeClusterPause(s);
      if (o.state === "paused") return { paused: true, detail: o.detail };
      if (o.state === "never-pauses") return { paused: false, reason: o.detail };
      last = o.detail;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    const left = deadline - now();
    if (left <= 0) break;
    await sleep(Math.min(interval, left));
  }
  return { paused: false, reason: `the cluster did not pause within ${String(Math.round(timeoutMs / 60_000))} minutes (PAR-281); last observed: ${last}` };
}
