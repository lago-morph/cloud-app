import { api } from "@lago-morph/prototype-framework/client";
import type { SessionDetail } from "../../shared/types";
import { describeError, el } from "../dom";
import { dayLabel, timeRange } from "../format";
import { announceSelection, setSelected } from "../selection";

let dialog: HTMLDialogElement | undefined;

function theDialog(): HTMLDialogElement {
  if (dialog !== undefined) return dialog;
  dialog = el("dialog");
  dialog.className = "details";
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  return dialog;
}

/** A labelled line of the details, left out when the value is empty. */
function fact(label: string, value: string): HTMLElement[] {
  if (value === "") return [];
  const term = el("dt", label);
  const desc = el("dd", value);
  return [term, desc];
}

/** Opens a dialog with a session's description, speakers, room and an add/remove button. */
export function showSession(sessionId: string): void {
  const box = theDialog();
  box.replaceChildren(el("p", "Loading…"));
  if (!box.open) box.showModal();
  void api<SessionDetail>(`/sessions/${encodeURIComponent(sessionId)}`)
    .then((s) => {
      const close = el("button", "Close");
      close.className = "close";
      close.addEventListener("click", () => box.close());

      let selected = s.selected;
      const toggle = el("button");
      const message = el("p");
      message.className = "error";
      const render = (): void => {
        toggle.textContent = selected ? "Remove from my schedule" : "Add to my schedule";
        toggle.className = selected ? "toggle on" : "toggle";
        toggle.setAttribute("aria-pressed", String(selected));
      };
      render();
      toggle.addEventListener("click", () => {
        const next = !selected;
        toggle.disabled = true;
        message.textContent = "";
        void setSelected(s.id, next)
          .then(() => {
            selected = next;
            render();
            announceSelection(s.id, next);
          })
          .catch((error: unknown) => {
            message.textContent = describeError(error);
          })
          .finally(() => {
            toggle.disabled = false;
          });
      });

      const facts = el("dl");
      facts.append(
        ...fact("When", `${dayLabel(s.day)}, ${timeRange(s.startsAt, s.endsAt)} (Salt Lake City time)`),
        ...fact("Room", s.room),
        ...fact("Track", s.track),
        ...fact("Format", s.format ?? ""),
        ...fact("Event", s.events.join(", ")),
      );
      const speakers = el("ul");
      speakers.className = "speakers";
      for (const p of s.speakerList) {
        const item = el("li");
        const name = el("strong", p.name);
        item.append(name);
        const role = [p.title, p.company].filter((v) => v !== null && v !== "").join(", ");
        if (role !== "") item.append(` — ${role}`);
        speakers.append(item);
      }
      const description = el("p", s.description === "" ? "No description." : s.description);
      description.className = "description";

      box.replaceChildren(close, el("h2", s.title), facts, toggle, message);
      if (s.speakerList.length > 0) box.append(el("h3", "Speakers"), speakers);
      box.append(el("h3", "Description"), description);
    })
    .catch((error: unknown) => {
      box.replaceChildren(el("p", describeError(error)));
    });
}
