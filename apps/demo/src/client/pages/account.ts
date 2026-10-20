import { login, logout, type CurrentUser } from "@lago-morph/prototype-framework/client";
import { el, link, section } from "../dom";

/** Login or logout controls for the header (DEMO-REQ-009). */
export function sessionControls(user: CurrentUser): HTMLElement {
  const box = el("span");
  if (user.level === "anonymous") {
    const button = el("button", "Log in");
    button.addEventListener("click", () => login());
    box.append(button);
    return box;
  }
  const button = el("button", "Log out");
  button.addEventListener("click", () => {
    void logout().then(() => window.location.assign("/"));
  });
  box.append(el("span", `${user.displayName ?? user.id} (${user.level}) `), button);
  return box;
}

/** The account page: the user ID with a copy button, so the owner can add it to the admin or users list. */
export function accountPage(user: CurrentUser): HTMLElement {
  const page = section("Account");
  if (user.level === "anonymous") {
    page.append(el("p", "You are not logged in."));
    const button = el("button", "Log in");
    button.addEventListener("click", () => login("/account"));
    page.append(button);
    return page;
  }
  page.append(el("p", `Logged in as ${user.displayName ?? "(no name)"}, level ${user.level}.`));
  const label = el("p", "Your user ID: ");
  const id = el("code", user.id);
  id.id = "user-id";
  label.append(id);
  const copy = el("button", "Copy user ID");
  copy.id = "copy-user-id";
  const message = el("p");
  copy.addEventListener("click", () => {
    void navigator.clipboard
      .writeText(user.id)
      .then(() => {
        message.textContent = "Copied.";
      })
      .catch(() => {
        message.textContent = "Copying failed; select the ID and copy it by hand.";
      });
  });
  page.append(label, copy, message, el("p", "Send this ID to the owner to be added to the admin or users list."), link("Back to posts", "/"));
  return page;
}
