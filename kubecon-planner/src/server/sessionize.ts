import { z } from "@lago-morph/prototype-framework";
import type { Speaker } from "../shared/types";

/**
 * Pure parsing of the public Sessionize feeds for KubeCon + CloudNativeCon North America 2026
 * (data/SOURCE.md). No I/O here: `schedule-import.ts` fetches and stores.
 */

export type FeedKind = "main" | "colocated" | "maintainer" | "sponsor";

/**
 * The feeds, in merge priority: on a repeated session ID the first feed's copy wins. The
 * sponsor-hosted feed repeats main-feed sessions; it is read so that a sponsor event missing
 * from the main feed is still imported.
 */
export const FEEDS: readonly { readonly kind: FeedKind; readonly code: string }[] = [
  { kind: "main", code: "svi82w6c" },
  { kind: "colocated", code: "ayajbd6b" },
  { kind: "maintainer", code: "qtujim6y" },
  { kind: "sponsor", code: "etvmcsmr" },
];

export function feedUrl(code: string): string {
  return `https://sessionize.com/api/v2/${code}/view/All`;
}

/** The track of the main feed's co-located umbrella blocks, and of every CNCF co-located talk here. */
export const COLOCATED_TRACK = "CNCF-hosted Co-located Events";
const MAINTAINER_TRACK = "Maintainer Summit";
const MAINTAINER_EVENT = "CNCF Maintainer Summit";
/** Labels of the co-located feed's "All Sessions" category that are kinds of entry, not events. */
const COLOCATED_KINDS = ["Breaks", "Experiences", "Registration"] as const;

export class FeedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedFormatError";
  }
}

/** One session as stored: Sessionize ID, event-local times, display fields. */
export interface ParsedSession {
  readonly id: string;
  readonly source: FeedKind;
  readonly title: string;
  readonly description: string;
  readonly day: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly room: string;
  readonly track: string;
  readonly format: string | null;
  readonly events: readonly string[];
  readonly speakers: readonly Speaker[];
}

const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, "a local time YYYY-MM-DDTHH:MM:SS");
const textId = z.union([z.string().min(1), z.number().int()]).transform(String);
const numId = z.number().int();

const feedSchema = z.object({
  sessions: z.array(
    z.object({
      id: textId,
      title: z.string(),
      description: z.string().nullish(),
      startsAt: localTime.nullish(),
      endsAt: localTime.nullish(),
      speakers: z.array(z.string()).nullish(),
      categoryItems: z.array(numId).nullish(),
      roomId: numId.nullish(),
    }),
  ),
  speakers: z.array(
    z.object({
      id: z.string(),
      fullName: z.string(),
      tagLine: z.string().nullish(),
      questionAnswers: z.array(z.object({ questionId: numId, answerValue: z.string().nullish() })).nullish(),
    }),
  ),
  questions: z.array(z.object({ id: numId, question: z.string() })),
  categories: z.array(z.object({ title: z.string(), items: z.array(z.object({ id: numId, name: z.string() })) })),
  rooms: z.array(z.object({ id: numId, name: z.string() })),
});

type Feed = z.infer<typeof feedSchema>;

/** "☕ Breaks" → "Breaks": drops leading symbols and spaces from a category label. */
function plainLabel(name: string): string {
  return name.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function speakersOf(feed: Feed): Map<string, Speaker> {
  const questionId = (name: string): number | undefined => feed.questions.find((q) => q.question === name)?.id;
  const companyQ = questionId("Company");
  const titleQ = questionId("Speaker Title");
  const map = new Map<string, Speaker>();
  for (const p of feed.speakers) {
    const answer = (id: number | undefined): string | null =>
      id === undefined ? null : nonEmpty(p.questionAnswers?.find((a) => a.questionId === id)?.answerValue);
    const company = answer(companyQ);
    const title = answer(titleQ) ?? (company === null ? nonEmpty(p.tagLine) : null);
    map.set(p.id, { name: p.fullName.trim(), company, title });
  }
  return map;
}

/** For each category item ID: its category's title and its own name. */
function categoryItems(feed: Feed): Map<number, { readonly category: string; readonly name: string }> {
  const map = new Map<number, { readonly category: string; readonly name: string }>();
  for (const c of feed.categories) for (const i of c.items) map.set(i.id, { category: c.title, name: i.name });
  return map;
}

interface Classification {
  readonly track: string;
  readonly format: string | null;
  readonly events: readonly string[];
}

function classify(kind: FeedKind, labels: readonly { readonly category: string; readonly name: string }[]): Classification {
  const named = (category: string): string[] => labels.filter((l) => l.category === category).map((l) => l.name);
  switch (kind) {
    case "main":
    case "sponsor":
      return { track: named("All Sessions")[0] ?? "Other", format: null, events: [] };
    case "colocated": {
      const groups = named("All Sessions").map(plainLabel);
      const entryKind = COLOCATED_KINDS.find((k) => groups.includes(k));
      return {
        track: entryKind ?? COLOCATED_TRACK,
        format: named("Session format").map(plainLabel)[0] ?? null,
        events: groups.filter((g) => !(COLOCATED_KINDS as readonly string[]).includes(g)),
      };
    }
    case "maintainer":
      return { track: MAINTAINER_TRACK, format: named("Session Category")[0] ?? null, events: [MAINTAINER_EVENT] };
  }
}

/**
 * Parses one feed's `view/All` JSON into sessions. Throws `FeedFormatError` when the JSON is not
 * that shape. A session without a start or end time is left out (it cannot be placed on a day).
 */
export function parseFeed(raw: unknown, kind: FeedKind): ParsedSession[] {
  const parsed = feedSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new FeedFormatError(`the ${kind} feed is not in the expected format (${issue === undefined ? "unknown" : `${issue.path.join(".")}: ${issue.message}`})`);
  }
  const feed = parsed.data;
  const speakers = speakersOf(feed);
  const items = categoryItems(feed);
  const rooms = new Map(feed.rooms.map((r) => [r.id, r.name.trim()]));
  const out: ParsedSession[] = [];
  for (const s of feed.sessions) {
    if (s.startsAt == null || s.endsAt == null) continue;
    const labels = (s.categoryItems ?? []).flatMap((i) => {
      const item = items.get(i);
      return item === undefined ? [] : [item];
    });
    out.push({
      id: s.id,
      source: kind,
      title: s.title.trim(),
      description: s.description ?? "",
      day: s.startsAt.slice(0, 10),
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      room: (s.roomId == null ? undefined : rooms.get(s.roomId)) ?? "",
      ...classify(kind, labels),
      speakers: (s.speakers ?? []).flatMap((id) => {
        const speaker = speakers.get(id);
        return speaker === undefined ? [] : [speaker];
      }),
    });
  }
  return out;
}

/**
 * Merges parsed feeds into one schedule, ordered by start time then ID:
 * - a session ID seen in more than one feed is kept once, from the first feed in `feeds`;
 * - the main feed's co-located umbrella blocks (track `COLOCATED_TRACK`) are dropped when the
 *   co-located feed has sessions, since its detailed talks replace them;
 * - the co-located feed's registration entries are dropped when the main feed has its own.
 */
export function mergeFeeds(feeds: readonly { readonly kind: FeedKind; readonly sessions: readonly ParsedSession[] }[]): ParsedSession[] {
  const has = (kind: FeedKind, test: (s: ParsedSession) => boolean = () => true): boolean =>
    feeds.some((f) => f.kind === kind && f.sessions.some(test));
  const colocatedPresent = has("colocated");
  const mainRegistration = has("main", (s) => s.track === "Registration");
  const seen = new Set<string>();
  const out: ParsedSession[] = [];
  for (const feed of feeds) {
    for (const s of feed.sessions) {
      if (seen.has(s.id)) continue;
      if (colocatedPresent && feed.kind !== "colocated" && s.track === COLOCATED_TRACK) continue;
      if (mainRegistration && feed.kind === "colocated" && s.track === "Registration") continue;
      seen.add(s.id);
      out.push(s);
    }
  }
  const key = (s: ParsedSession): string => `${s.startsAt} ${s.id.padStart(12, "0")}`;
  return out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** "Name (Company), Name": the speakers line shown in lists and matched by search. */
export function speakerText(speakers: readonly Speaker[]): string {
  return speakers.map((s) => (s.company === null ? s.name : `${s.name} (${s.company})`)).join(", ");
}
