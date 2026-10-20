import { api } from "@lago-morph/prototype-framework/client";
import type { NoteList } from "../../shared/types";
import { describeError, el, section } from "../dom";

/** Write a note and list your own notes (SQL). */
export function notesPage(): HTMLElement {
  const page = section("Notes");
  const input = el("input");
  input.placeholder = "Write a note";
  const add = el("button", "Add");
  const message = el("p");
  const list = el("ul");
  page.append(input, add, message, list);

  async function refresh(): Promise<void> {
    const { notes } = await api<NoteList>("/notes");
    list.replaceChildren(...notes.map((n) => el("li", `${new Date(n.createdAt).toLocaleString()}: ${n.text}`)));
  }

  add.addEventListener("click", () => {
    message.textContent = "";
    void api("/notes", { method: "POST", body: { text: input.value } })
      .then(() => {
        input.value = "";
        return refresh();
      })
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
  });

  void refresh().catch((error: unknown) => {
    message.textContent = describeError(error);
  });
  return page;
}
