import { z } from "@lago-morph/prototype-framework";
import { vi } from "vitest";
import { FEEDS, feedUrl, type FeedKind } from "../../src/server/sessionize";
import { feed as colocated } from "../fixtures/sessionize/colocated";
import { feed as main } from "../fixtures/sessionize/main";
import { feed as maintainer } from "../fixtures/sessionize/maintainer";
import { feed as sponsor } from "../fixtures/sessionize/sponsor";

/**
 * A stand-in for the Sessionize API in in-process tests: Sessionize is an external service
 * with no local stand-in, so the app's outbound `fetch` is replaced by one that answers the
 * four feed URLs from the fixtures (or as a test sets), and records each URL asked for.
 */

type FeedAnswer = { readonly json: unknown } | { readonly respond: () => Response };

export const fixtureFeeds: Readonly<Record<FeedKind, unknown>> = { main, colocated, maintainer, sponsor };

const looseFeed = z.looseObject({ sessions: z.array(z.looseObject({ id: z.string(), title: z.string() })) });

/** A copy of `feed` with `change` applied to its sessions. */
export function editFeed(feed: unknown, change: (sessions: z.infer<typeof looseFeed>["sessions"]) => z.infer<typeof looseFeed>["sessions"]): unknown {
  const parsed = looseFeed.parse(structuredClone(feed));
  return { ...parsed, sessions: change(parsed.sessions) };
}

export interface FakeSessionize {
  /** URLs fetched so far. */
  readonly calls: string[];
  /** Makes one feed answer this JSON value. */
  setJson(kind: FeedKind, json: unknown): void;
  /** Makes one feed answer with this response. */
  setResponse(kind: FeedKind, respond: () => Response): void;
}

function urlOf(kind: FeedKind): string {
  const code = FEEDS.find((f) => f.kind === kind)?.code;
  if (code === undefined) throw new Error(`no feed ${kind}`);
  return feedUrl(code);
}

/** Replaces the global `fetch` until `vi.unstubAllGlobals()`. */
export function fakeSessionize(): FakeSessionize {
  const answers = new Map<string, FeedAnswer>(FEEDS.map((f) => [feedUrl(f.code), { json: fixtureFeeds[f.kind] }]));
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    const answer = answers.get(url);
    if (answer === undefined) return new Response("not found", { status: 404 });
    return "respond" in answer ? answer.respond() : Response.json(answer.json);
  });
  return {
    calls,
    setJson(kind, json) {
      answers.set(urlOf(kind), { json });
    },
    setResponse(kind, respond) {
      answers.set(urlOf(kind), { respond });
    },
  };
}
