import { api } from "@lago-morph/prototype-framework/client";
import type { Created, DraftList, Site } from "../../shared/types";
import { button, describeError, el, link, section, when } from "../dom";

/** Create a draft and list your own drafts (DEMO-REQ-002). Editing, photos and sharing are on the post page. */
export function draftsPage(site: Site): HTMLElement {
  const page = section("My drafts");
  const title = el("input");
  title.placeholder = "Title";
  title.maxLength = 120;
  const body = el("textarea");
  body.placeholder = "Text";
  const message = el("p");
  const list = el("ul");
  page.append(
    el("p", `Each post can have up to ${site.maxPhotosPerPost} photos.`),
    title,
    body,
    button("Create draft", message, async () => {
      const { id } = await api<Created>("/posts", { method: "POST", body: { title: title.value, body: body.value } });
      window.location.assign(`/post/${id}`);
    }),
    message,
    list,
  );
  void api<DraftList>("/drafts")
    .then(({ posts }) => {
      list.replaceChildren(
        ...posts.map((p) => {
          const item = el("li");
          item.append(link(`/post/${p.id}`, p.title), ` (updated ${when(p.updatedAt)})`);
          return item;
        }),
      );
    })
    .catch((error: unknown) => {
      message.textContent = describeError(error);
    });
  return page;
}
