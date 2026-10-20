import { api, login, type CurrentUser } from "@lago-morph/prototype-framework/client";
import type { Preferences } from "../../shared/types";
import { el, report, section } from "../dom";

/** The logged-in user's ID with a copy button (for the admin list), and the posts-per-page preference. */
export function accountPage(user: CurrentUser): HTMLElement {
  const page = section("Account");
  if (user.level === "anonymous") {
    page.append(el("p", "You are not logged in."));
    const button = el("button", "Log in");
    button.addEventListener("click", () => login());
    page.append(button);
    return page;
  }

  const idLine = el("p", "Your user ID: ");
  const id = el("code", user.id);
  id.id = "user-id";
  const copy = el("button", "Copy ID");
  const copied = el("span");
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(user.id).then(
      () => {
        copied.textContent = " Copied.";
      },
      () => {
        copied.textContent = " Copy failed: select the ID and copy it by hand.";
      },
    );
  });
  idLine.append(id, " ", copy, copied);
  page.append(idLine, el("p", `Level: ${user.level}`));

  const label = el("label", "Posts per page: ");
  const perPage = el("input");
  perPage.type = "number";
  perPage.min = "1";
  perPage.max = "50";
  label.append(perPage);
  const save = el("button", "Save");
  const message = el("p");
  page.append(label, save, message);

  save.addEventListener("click", () => {
    message.textContent = "";
    report(
      message,
      api<Preferences>("/preferences", { method: "PUT", body: { perPage: Number(perPage.value) } }).then(() => {
        message.textContent = "Saved.";
      }),
    );
  });
  report(
    message,
    api<Preferences>("/preferences").then((prefs) => {
      perPage.value = String(prefs.perPage);
    }),
  );
  return page;
}
