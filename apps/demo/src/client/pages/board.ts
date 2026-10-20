import { api, type CurrentUser } from "@lago-morph/prototype-framework/client";
import type { PostPage, Preferences } from "../../shared/types";
import { button, describeError, el, link, section, when } from "../dom";

const PAGE_SIZES = [5, 10, 20, 50];

/** Published posts, newest first, a page at a time; logged-in users choose the page size (DEMO-REQ-001, -005). */
export function boardPage(user: CurrentUser): HTMLElement {
  const page = section("Posts");
  const message = el("p");
  const list = el("ul");
  const pager = el("p");
  let current = 1;

  async function show(pageNumber: number): Promise<void> {
    const result = await api<PostPage>("/posts", { query: { page: String(pageNumber) } });
    current = result.page;
    list.replaceChildren(
      ...result.posts.map((p) => {
        const item = el("li");
        item.append(link(`/post/${p.id}`, p.title), ` (${when(p.createdAt)})`);
        return item;
      }),
    );
    if (result.posts.length === 0) list.append(el("li", "No posts yet."));
    pager.replaceChildren(`Page ${result.page} `);
    if (result.page > 1) pager.append(button("Previous", message, () => show(current - 1)));
    if (result.hasMore) pager.append(button("Next", message, () => show(current + 1)));
  }

  if (user.level !== "anonymous") {
    const select = el("select");
    for (const size of PAGE_SIZES) {
      const option = el("option", String(size));
      option.value = String(size);
      select.append(option);
    }
    const label = el("label", "Posts per page ");
    label.append(select);
    page.append(label);
    void api<Preferences>("/preferences")
      .then(({ pageSize }) => {
        select.value = String(pageSize);
      })
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
    select.addEventListener("change", () => {
      void api<Preferences>("/preferences", { method: "PUT", body: { pageSize: Number(select.value) } })
        .then(() => show(1))
        .catch((error: unknown) => {
          message.textContent = describeError(error);
        });
    });
  }

  page.append(list, pager, message);
  void show(1).catch((error: unknown) => {
    message.textContent = describeError(error);
  });
  return page;
}
