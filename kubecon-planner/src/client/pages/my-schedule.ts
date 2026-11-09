import { api } from "@lago-morph/prototype-framework/client";
import type { MyDay, MySchedule, PlacedSession } from "../../shared/types";
import { describeError, el } from "../dom";
import { clock, dayLabel, timeRange, weekday } from "../format";
import { showSession } from "./session-dialog";

/** Grid scale: pixels per minute (one hour is 72 px). */
const PX_PER_MINUTE = 1.2;
/** The shortest block drawn, so a two-minute talk is still readable. */
const MIN_BLOCK_PX = 22;
/** Hours shown when a day has no selections. */
const DEFAULT_HOURS: readonly [number, number] = [8, 18];

function hoursOf(day: MyDay): [number, number] {
  if (day.sessions.length === 0) return [DEFAULT_HOURS[0], DEFAULT_HOURS[1]];
  const first = Math.min(...day.sessions.map((s) => s.startMinute));
  const last = Math.max(...day.sessions.map((s) => Math.max(s.endMinute, s.startMinute + MIN_BLOCK_PX / PX_PER_MINUTE)));
  return [Math.floor(first / 60), Math.min(24, Math.ceil(last / 60))];
}

function block(s: PlacedSession, startHour: number, titles: ReadonlyMap<string, string>): HTMLElement {
  const node = el("button");
  node.className = s.conflictsWith.length > 0 ? "block conflict" : "block";
  node.dataset["sessionId"] = s.id;
  node.style.top = `${(s.startMinute - startHour * 60) * PX_PER_MINUTE}px`;
  node.style.height = `${Math.max((s.endMinute - s.startMinute) * PX_PER_MINUTE, MIN_BLOCK_PX)}px`;
  node.style.left = `calc(${(s.column / s.columns) * 100}% + 2px)`;
  node.style.width = `calc(${100 / s.columns}% - 4px)`;
  const others = s.conflictsWith.map((id) => titles.get(id) ?? id);
  node.title = others.length > 0 ? `${s.title}\nConflicts with: ${others.join("; ")}` : s.title;

  const time = el("span", timeRange(s.startsAt, s.endsAt));
  time.className = "time";
  const title = el("span", s.title);
  title.className = "name";
  node.append(time);
  if (s.conflictsWith.length > 0) {
    const badge = el("span", s.conflictsWith.length === 1 ? "Conflict" : `Conflicts ×${s.conflictsWith.length}`);
    badge.className = "badge";
    node.append(badge);
  }
  node.append(title);
  if (s.room !== "") {
    const room = el("span", s.room);
    room.className = "room";
    node.append(room);
  }
  node.addEventListener("click", () => showSession(s.id));
  return node;
}

function grid(day: MyDay): HTMLElement {
  const [startHour, endHour] = hoursOf(day);
  const wrap = el("div");
  wrap.className = "grid";
  const height = (endHour - startHour) * 60 * PX_PER_MINUTE;

  const gutter = el("div");
  gutter.className = "hours";
  gutter.style.height = `${height}px`;
  const lanes = el("div");
  lanes.className = "lanes";
  lanes.style.height = `${height}px`;
  for (let h = startHour; h < endHour; h++) {
    const label = el("span", clock(h * 60));
    label.style.top = `${(h - startHour) * 60 * PX_PER_MINUTE}px`;
    gutter.append(label);
    const line = el("div");
    line.className = "hour-line";
    line.style.top = `${(h - startHour) * 60 * PX_PER_MINUTE}px`;
    lanes.append(line);
  }
  const titles = new Map(day.sessions.map((s) => [s.id, s.title]));
  for (const s of day.sessions) lanes.append(block(s, startHour, titles));
  wrap.append(gutter, lanes);
  return wrap;
}

/** My schedule: one tab per conference day, each a vertical time grid of the selected sessions. */
export function myScheduleView(): { readonly element: HTMLElement; refresh(): void } {
  const page = el("section");
  page.className = "mine";
  const tabs = el("div");
  tabs.className = "day-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Conference days");
  const summary = el("p");
  summary.className = "summary";
  const panel = el("div");
  panel.setAttribute("role", "tabpanel");
  const message = el("p");
  message.className = "error";
  page.append(tabs, summary, message, panel);

  let chosen: string | undefined;
  let schedule: MySchedule = { days: [], conflicted: 0 };

  function render(): void {
    if (schedule.days.length === 0) {
      tabs.replaceChildren();
      summary.textContent = "The schedule has not been imported yet: open Browse sessions first.";
      panel.replaceChildren();
      return;
    }
    if (chosen === undefined || !schedule.days.some((d) => d.day === chosen)) {
      chosen = (schedule.days.find((d) => d.sessions.length > 0) ?? schedule.days[0])?.day;
    }
    tabs.replaceChildren(
      ...schedule.days.map((d) => {
        const tab = el("button");
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", String(d.day === chosen));
        tab.className = d.day === chosen ? "tab active" : "tab";
        const conflicts = d.sessions.filter((s) => s.conflictsWith.length > 0).length;
        tab.append(el("span", weekday(d.day)), el("small", d.day.slice(5).replace("-", "/")));
        const n = el("small", conflicts > 0 ? `${d.sessions.length} · ${conflicts} in conflict` : `${d.sessions.length}`);
        n.className = conflicts > 0 ? "n warn" : "n";
        tab.append(n);
        tab.setAttribute("aria-label", `${dayLabel(d.day)}: ${d.sessions.length} selected${conflicts > 0 ? `, ${conflicts} in conflict` : ""}`);
        tab.addEventListener("click", () => {
          chosen = d.day;
          render();
        });
        return tab;
      }),
    );
    const day = schedule.days.find((d) => d.day === chosen);
    if (day === undefined) return;
    const conflicts = day.sessions.filter((s) => s.conflictsWith.length > 0).length;
    summary.textContent =
      day.sessions.length === 0
        ? `${dayLabel(day.day)}: nothing selected yet. Add sessions from Browse sessions.`
        : `${dayLabel(day.day)}: ${day.sessions.length} selected${conflicts > 0 ? `, ${conflicts} overlapping (shown side by side in red)` : ", no conflicts"}. Salt Lake City time (MST).`;
    panel.replaceChildren(grid(day));
  }

  function refresh(): void {
    message.textContent = "";
    void api<MySchedule>("/my-schedule")
      .then((body) => {
        schedule = body;
        render();
      })
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
  }

  return { element: page, refresh };
}
