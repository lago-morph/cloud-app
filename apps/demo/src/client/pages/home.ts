import { api, type CurrentUser } from "@lago-morph/prototype-framework/client";
import type { Banner, Created, PostList, PostPage, PostSummary } from "../../shared/types";
import { el, link, report, section, when } from "../dom";

function postItem(post: PostSummary): HTMLLIElement {
  const item = el("li");
  item.append(link(`/posts/${post.id}`, post.title), ` by ${post.authorName ?? "a user"}, ${when(post.createdAt)}`);
  if (post.status === "draft") item.append(" (draft)");
  return item;
}

function publishedSection(): HTMLElement {
  const page = section("Published posts");
  const list = el("ul");
  const pager = el("p");
  const message = el("p");
  page.append(list, pager, message);
  const current = Number(new URLSearchParams(window.location.search).get("page") ?? "1");
  const pageNumber = Number.isInteger(current) && current >= 1 ? current : 1;
  report(
    message,
    api<PostPage>("/posts", { query: { page: String(pageNumber) } }).then((result) => {
      list.replaceChildren(...result.posts.map(postItem));
      if (result.posts.length === 0) list.append(el("li", "No posts yet."));
      pager.replaceChildren(`Page ${result.page} `);
      if (result.page > 1) pager.append(link(`/?page=${result.page - 1}`, "Newer"), " ");
      if (result.hasMore) pager.append(link(`/?page=${result.page + 1}`, "Older"));
    }),
  );
  return page;
}

function newPostSection(): HTMLElement {
  const page = section("New draft");
  const title = el("input");
  title.placeholder = "Title";
  title.maxLength = 120;
  const body = el("textarea");
  body.placeholder = "Text";
  const create = el("button", "Create draft");
  const message = el("p");
  page.append(title, el("br"), body, el("br"), create, message);
  create.addEventListener("click", () => {
    message.textContent = "";
    report(
      message,
      api<Created>("/posts", { method: "POST", body: { title: title.value, body: body.value } }).then(({ id }) => {
        window.location.assign(`/posts/${id}`);
      }),
    );
  });
  return page;
}

function listSection(title: string, path: string): HTMLElement {
  const page = section(title);
  const list = el("ul");
  const message = el("p");
  page.append(list, message);
  report(
    message,
    api<PostList>(path).then(({ posts }) => {
      list.replaceChildren(...posts.map(postItem));
      if (posts.length === 0) list.append(el("li", "None."));
    }),
  );
  return page;
}

function bannerSection(): HTMLElement {
  const page = section("Site banner");
  const input = el("input");
  input.placeholder = "Banner message (empty clears it)";
  input.maxLength = 300;
  const save = el("button", "Set banner");
  const message = el("p");
  page.append(input, save, message);
  save.addEventListener("click", () => {
    report(
      message,
      api<Banner>("/banner", { method: "PUT", body: { banner: input.value } }).then(() => window.location.reload()),
    );
  });
  return page;
}

/** The front page: published posts for everyone; drafts for users; the banner and all drafts for admins. */
export function homePage(user: CurrentUser): HTMLElement {
  const page = el("div");
  page.append(publishedSection());
  if (user.level === "anonymous") return page;
  page.append(newPostSection(), listSection("My posts", "/posts/mine"));
  if (user.level === "admin") page.append(listSection("All drafts (admin)", "/admin/drafts"), bannerSection());
  return page;
}
