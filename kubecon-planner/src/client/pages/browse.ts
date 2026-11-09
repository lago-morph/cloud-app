import { api } from "@lago-morph/prototype-framework/client";
import type { ImportResult, ScheduleMeta, SessionList, SessionSummary } from "../../shared/types";
import { describeError, el } from "../dom";
import { dayLabel, timeRange } from "../format";
import { announceSelection, onSelection, setSelected } from "../selection";
import { showSession } from "./session-dialog";

function option(value: string, label: string): HTMLOptionElement {
  const node = el("option", label);
  node.value = value;
  return node;
}

function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = el("label");
  label.append(el("span", text), control);
  return label;
}

function lastImportText(meta: ScheduleMeta): string {
  if (meta.lastImport === null) return "Not imported yet.";
  return `${meta.sessionCount} sessions, imported ${new Date(meta.lastImport.at).toLocaleString()}.`;
}

/**
 * Browse: every session by day, with search (title, speaker, company) and filters (day,
 * track or type, co-located event), each with an add/remove toggle and a details dialog.
 */
export function browsePage(): HTMLElement {
  const page = el("section");
  page.className = "browse";

  const search = el("input");
  search.type = "search";
  search.placeholder = "Title, speaker or company";
  const day = el("select");
  const track = el("select");
  const event = el("select");
  const filters = el("div");
  filters.className = "filters";
  filters.append(labelled("Search", search), labelled("Day", day), labelled("Track / type", track), labelled("Co-located event", event));

  const refresh = el("button", "Refresh schedule");
  const status = el("p");
  status.className = "status";
  const source = el("div");
  source.className = "source";
  source.append(status, refresh);

  const count = el("p");
  count.className = "count";
  const message = el("p");
  message.className = "error";
  const results = el("div");
  results.className = "results";
  page.append(source, filters, count, message, results);

  const toggles = new Map<string, (selected: boolean) => void>();
  onSelection((id, selected) => toggles.get(id)?.(selected));

  function row(s: SessionSummary): HTMLElement {
    const item = el("article");
    item.className = "session";
    item.dataset["sessionId"] = s.id;

    const when = el("div", timeRange(s.startsAt, s.endsAt));
    when.className = "when";
    const title = el("button", s.title);
    title.className = "title link";
    title.addEventListener("click", () => showSession(s.id));
    const facts = [s.room, s.track, s.format ?? "", s.events.join(", ")].filter((v) => v !== "");
    const meta = el("div", facts.join(" · "));
    meta.className = "meta";
    const body = el("div");
    body.className = "body";
    body.append(title, meta);
    if (s.speakers !== "") {
      const who = el("div", s.speakers);
      who.className = "speakers";
      body.append(who);
    }

    let selected = s.selected;
    const toggle = el("button");
    const render = (): void => {
      toggle.textContent = selected ? "✓ In my schedule" : "Add";
      toggle.className = selected ? "toggle on" : "toggle";
      toggle.setAttribute("aria-pressed", String(selected));
      toggle.setAttribute("aria-label", `${selected ? "Remove" : "Add"} ${s.title}`);
      item.classList.toggle("selected", selected);
    };
    render();
    toggles.set(s.id, (value) => {
      selected = value;
      render();
    });
    toggle.addEventListener("click", () => {
      const next = !selected;
      toggle.disabled = true;
      message.textContent = "";
      void setSelected(s.id, next)
        .then(() => announceSelection(s.id, next))
        .catch((error: unknown) => {
          message.textContent = describeError(error);
        })
        .finally(() => {
          toggle.disabled = false;
        });
    });
    item.append(when, body, toggle);
    return item;
  }

  let generation = 0;
  async function load(): Promise<void> {
    const mine = ++generation;
    const query: Record<string, string> = {};
    if (search.value.trim() !== "") query["q"] = search.value.trim();
    if (day.value !== "") query["day"] = day.value;
    if (track.value !== "") query["track"] = track.value;
    if (event.value !== "") query["event"] = event.value;
    const { sessions } = await api<SessionList>("/sessions", { query });
    if (mine !== generation) return;
    toggles.clear();
    count.textContent = sessions.length === 1 ? "1 session" : `${sessions.length} sessions`;
    const groups: HTMLElement[] = [];
    let current = "";
    let group: HTMLElement | undefined;
    for (const s of sessions) {
      if (s.day !== current || group === undefined) {
        current = s.day;
        group = el("section");
        group.className = "day";
        group.append(el("h3", dayLabel(s.day)));
        groups.push(group);
      }
      group.append(row(s));
    }
    results.replaceChildren(...groups);
  }

  function reload(): void {
    message.textContent = "";
    void load().catch((error: unknown) => {
      message.textContent = describeError(error);
    });
  }

  async function loadMeta(): Promise<ScheduleMeta> {
    const meta = await api<ScheduleMeta>("/schedule/meta");
    const keep = { day: day.value, track: track.value, event: event.value };
    day.replaceChildren(option("", "All days"), ...meta.days.map((d) => option(d.day, `${dayLabel(d.day)} (${d.count})`)));
    track.replaceChildren(option("", "All tracks"), ...meta.tracks.map((t) => option(t, t)));
    event.replaceChildren(option("", "All events"), ...meta.events.map((e) => option(e, e)));
    day.value = keep.day;
    track.value = keep.track;
    event.value = keep.event;
    status.textContent = `${lastImportText(meta)} Times are Salt Lake City time (MST).`;
    return meta;
  }

  async function importSchedule(onlyIfEmpty: boolean): Promise<void> {
    refresh.disabled = true;
    status.textContent = "Importing the schedule from Sessionize…";
    try {
      await api<ImportResult>("/schedule/refresh", { method: "POST", body: { onlyIfEmpty } });
    } finally {
      refresh.disabled = false;
    }
  }

  refresh.addEventListener("click", () => {
    message.textContent = "";
    void importSchedule(false)
      .then(loadMeta)
      .then(load)
      .catch((error: unknown) => {
        message.textContent = describeError(error);
        void loadMeta().catch(() => undefined);
      });
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener("input", () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(reload, 250);
  });
  for (const select of [day, track, event]) select.addEventListener("change", reload);

  // Import automatically when the schedule is empty, then show it.
  void (async () => {
    const meta = await loadMeta();
    if (meta.sessionCount === 0) {
      await importSchedule(true);
      await loadMeta();
    }
    await load();
  })().catch((error: unknown) => {
    message.textContent = describeError(error);
  });

  return page;
}
