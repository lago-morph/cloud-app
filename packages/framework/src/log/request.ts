/**
 * CORE's `createLog` slot (core.md §2): one writer per request, carrying the request ID and the
 * method and path (without query) for `logFailure`. Each target runtime passes its own sink.
 */
import type { RuntimeContext } from "../core/assemble.js";
import type { Deployment } from "../core/identity.js";
import type { LogService } from "./public.js";
import { createLogWriter, type LogSink } from "./writer.js";

export function requestLogFactory(deployment: Deployment, sink: LogSink): (c: RuntimeContext) => LogService {
  return (c) =>
    createLogWriter({ deployment, requestId: c.get("requestId"), request: { method: c.req.method, path: c.req.path } }, sink);
}
