import { api } from "@lago-morph/prototype-framework/client";
import type { Status } from "../../shared/types";
import { describeError, el, section } from "../dom";

/** Read and change your status line (KV). */
export function statusPage(): HTMLElement {
  const page = section("Status");
  const input = el("input");
  input.placeholder = "Your status";
  const save = el("button", "Save");
  const message = el("p");
  page.append(input, save, message);

  save.addEventListener("click", () => {
    message.textContent = "";
    void api<Status>("/status", { method: "PUT", body: { status: input.value } })
      .then(() => {
        message.textContent = "Saved.";
      })
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
  });

  void api<Status>("/status")
    .then(({ status }) => {
      input.value = status ?? "";
    })
    .catch((error: unknown) => {
      message.textContent = describeError(error);
    });
  return page;
}
