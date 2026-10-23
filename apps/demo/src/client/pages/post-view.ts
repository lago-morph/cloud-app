import { api, downloadUrl, uploadFile, type CurrentUser, type DownloadTicket, type UploadTicket } from "@lago-morph/prototype-framework/client";
import type { PhotoUpload, Post, PostSummary, ShareLink, StoredPhoto } from "../../shared/types";
import { describeError, el, section } from "../dom";

type FullPost = Post<DownloadTicket>;

/** The post's title, body and photos, all as text or images (never HTML). */
function renderPost(post: FullPost): HTMLElement[] {
  const nodes: HTMLElement[] = [el("h2", post.title), el("p", `${post.status} · ${new Date(post.createdAt).toLocaleString()}`)];
  const body = el("p", post.body);
  body.style.whiteSpace = "pre-wrap";
  nodes.push(body);
  for (const photo of post.photos) {
    const img = el("img");
    img.src = downloadUrl(photo.ticket);
    img.alt = photo.name;
    img.style.maxWidth = "100%";
    const link = el("a", `${photo.name} (${photo.size} bytes)`);
    link.href = downloadUrl(photo.ticket);
    link.target = "_blank";
    link.rel = "noopener";
    const figure = el("figure");
    const caption = el("figcaption");
    caption.append(link);
    figure.append(img, caption);
    nodes.push(figure);
  }
  return nodes;
}

/** The author's tools on an own draft: edit, add photos, share, delete. */
function authorTools(post: FullPost, reload: () => void, message: HTMLElement): HTMLElement {
  const tools = section("Edit draft");
  const title = el("input");
  title.value = post.title;
  title.maxLength = 120;
  const body = el("textarea");
  body.value = post.body;
  const save = el("button", "Save");
  save.addEventListener("click", () => {
    void api<FullPost>(`/posts/${post.id}`, { method: "PATCH", body: { title: title.value, body: body.value } })
      .then(reload)
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
  });

  const picker = el("input");
  picker.type = "file";
  picker.accept = "image/jpeg,image/png";
  const upload = el("button", "Add photo");
  upload.addEventListener("click", () => {
    const file = picker.files?.[0];
    if (file === undefined) {
      message.textContent = "Choose a JPEG or PNG photo first.";
      return;
    }
    message.textContent = "Uploading…";
    void api<PhotoUpload<UploadTicket>>(`/posts/${post.id}/photos/upload-ticket`, { method: "POST", body: { contentType: file.type } })
      .then(async ({ photoId, ticket }) => {
        await uploadFile(ticket, file, {
          onProgress: (p) => {
            message.textContent = `Uploading… ${p.loaded} of ${p.total} bytes`;
          },
        });
        return api<StoredPhoto>(`/posts/${post.id}/photos/finalize`, { method: "POST", body: { photoId, name: file.name } });
      })
      .then(reload)
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
  });

  const share = el("button", "Create share link");
  const shareOut = el("p");
  share.addEventListener("click", () => {
    void api<ShareLink>(`/posts/${post.id}/share`, { method: "POST" })
      .then(({ token, expiresAt }) => {
        const url = `${window.location.origin}/?share=${encodeURIComponent(token)}`;
        const link = el("a", url);
        link.href = url;
        shareOut.replaceChildren(link, ` (valid until ${new Date(expiresAt).toLocaleString()})`);
      })
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
  });

  tools.append(el("label", "Title"), title, el("label", "Text"), body, save, el("h3", "Photos"), picker, upload, el("h3", "Share"), share, shareOut);
  return tools;
}

/** Admin tools: publish, unpublish. */
function adminTools(post: FullPost, reload: () => void, message: HTMLElement): HTMLElement {
  const tools = section("Admin");
  const action = post.status === "draft" ? "publish" : "unpublish";
  const button = el("button", post.status === "draft" ? "Publish" : "Unpublish");
  button.addEventListener("click", () => {
    void api<PostSummary>(`/posts/${post.id}/${action}`, { method: "POST" })
      .then(reload)
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
  });
  tools.append(button);
  return tools;
}

/** One post (DEMO-REQ-001, -002, -003, -007). */
export function postView(postId: string, user: CurrentUser): HTMLElement {
  const page = el("article");
  const message = el("p");

  async function load(): Promise<void> {
    const post = await api<FullPost>(`/posts/${encodeURIComponent(postId)}`);
    const nodes = renderPost(post);
    const reload = (): void => {
      message.textContent = "";
      void load().catch((error: unknown) => {
        message.textContent = describeError(error);
      });
    };
    const isAuthor = user.level !== "anonymous" && user.id === post.authorId;
    if (isAuthor && post.status === "draft") nodes.push(authorTools(post, reload, message));
    if (user.level === "admin") nodes.push(adminTools(post, reload, message));
    if ((isAuthor && post.status === "draft") || user.level === "admin") {
      const del = el("button", "Delete post");
      del.addEventListener("click", () => {
        void api(`/posts/${post.id}`, { method: "DELETE" })
          .then(() => {
            window.location.assign("/");
          })
          .catch((error: unknown) => {
            message.textContent = describeError(error);
          });
      });
      nodes.push(del);
    }
    page.replaceChildren(...nodes, message);
  }

  page.append(message);
  void load().catch((error: unknown) => {
    message.textContent = describeError(error);
  });
  return page;
}

/** A draft opened through a share link. */
export function sharedPostView(token: string): HTMLElement {
  const page = el("article");
  const message = el("p", "Loading…");
  page.append(message);
  void api<FullPost>("/shared", { query: { token } })
    .then((post) => {
      page.replaceChildren(el("p", "Shared draft"), ...renderPost(post));
    })
    .catch((error: unknown) => {
      message.textContent = describeError(error);
    });
  return page;
}
