import { api } from "@lago-morph/prototype-framework/client";
import type { Banner, Site } from "../../shared/types";
import { button, el, section } from "../dom";

/** Admins only: set or clear the site banner (DEMO-REQ-004). The server guard is the protection. */
export function adminPage(site: Site): HTMLElement {
  const page = section("Site banner");
  const input = el("input");
  input.maxLength = 500;
  input.value = site.banner ?? "";
  input.placeholder = "Banner message";
  const message = el("p");
  const save = button("Set banner", message, async () => {
    await api<Banner>("/banner", { method: "PUT", body: { banner: input.value } });
    window.location.reload();
  });
  const clear = button("Clear banner", message, async () => {
    await api<Banner>("/banner", { method: "PUT", body: { banner: null } });
    window.location.reload();
  });
  page.append(input, save, clear, message);
  return page;
}
