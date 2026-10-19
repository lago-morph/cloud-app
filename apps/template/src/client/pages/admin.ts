import { api } from "@lago-morph/prototype-framework/client";
import type { SecretCheck } from "../../shared/types";
import { describeError, el, section } from "../dom";

/** Admins only: check that the app's secret is set (never shows its value). */
export function adminPage(): HTMLElement {
  const page = section("Admin");
  const check = el("button", "Check secret");
  const message = el("p");
  page.append(check, message);
  check.addEventListener("click", () => {
    void api<SecretCheck>("/admin/secret")
      .then(({ configured }) => {
        message.textContent = configured ? "The secret apiKey is set." : "The secret apiKey is empty.";
      })
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
  });
  return page;
}
