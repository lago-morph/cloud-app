import { login, logout, type CurrentUser } from "@lago-morph/prototype-framework/client";
import { button, el, section } from "../dom";

/** Login and logout, and the user's ID with a copy button so the owner can add it to a list (DEMO-REQ-009). */
export function accountPage(user: CurrentUser): HTMLElement {
  const page = section("Account");
  const message = el("p");
  if (user.level === "anonymous") {
    page.append(el("p", "You are not logged in."), button("Log in", message, async () => login("/account")), message);
    return page;
  }
  const id = el("code", user.id);
  id.id = "user-id";
  const idLine = el("p", "Your user ID: ");
  idLine.append(id, " ");
  idLine.append(
    button("Copy", message, async () => {
      await navigator.clipboard.writeText(user.id);
      message.textContent = "Copied.";
    }),
  );
  page.append(
    el("p", `Logged in as ${user.displayName ?? user.id} (${user.level}).`),
    idLine,
    button("Log out", message, async () => {
      await logout();
      window.location.assign("/");
    }),
    message,
  );
  return page;
}
