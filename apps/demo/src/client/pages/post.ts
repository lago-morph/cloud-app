import { api, downloadUrl, uploadFile, type CurrentUser, type DownloadTicket, type UploadTicket } from "@lago-morph/prototype-framework/client";
import type { PhotoUpload, PostDetail, ShareLink, SiteInfo, StoredPhoto } from "../../shared/types";
import { el, link, report, section, when } from "../dom";

/** The post's title, text and photos; every value is set as text or as an attribute, never as HTML. */
function render(detail: PostDetail<DownloadTicket>): HTMLElement {
  const { post } = detail;
  const page = el("article");
  page.append(el("h2", post.title));
  page.append(el("p", `${post.status === "draft" ? "Draft" : "Published"} by ${post.authorName ?? "a user"} · created ${when(post.createdAt)} · updated ${when(post.updatedAt)}`));
  const body = el("p", post.body);
  body.style.whiteSpace = "pre-wrap";
  page.append(body);
  for (const photo of detail.photos) {
    const figure = el("figure");
    const image = el("img");
    image.src = downloadUrl(photo.ticket);
    image.alt = `Photo of ${post.title}`;
    image.style.maxWidth = "100%";
    const caption = el("figcaption");
    caption.append(`${photo.contentType}, ${photo.size} bytes · `, link(downloadUrl(photo.ticket), "Download original"));
    figure.append(image, caption);
    page.append(figure);
  }
  return page;
}

function authorControls(postId: string, detail: PostDetail<DownloadTicket>, site: SiteInfo, message: HTMLElement): HTMLElement {
  const controls = section("Edit draft");
  const title = el("input");
  title.value = detail.post.title;
  title.maxLength = 120;
  const body = el("textarea");
  body.value = detail.post.body;
  const save = el("button", "Save");
  save.addEventListener("click", () => {
    report(message, api(`/posts/${postId}`, { method: "PUT", body: { title: title.value, body: body.value } }).then(() => window.location.reload()));
  });

  const picker = el("input");
  picker.type = "file";
  picker.accept = "image/jpeg,image/png";
  const upload = el("button", `Attach photo (at most ${site.maxPhotosPerPost})`);
  upload.addEventListener("click", () => {
    const file = picker.files?.[0];
    if (file === undefined) {
      message.textContent = "Choose a JPEG or PNG first.";
      return;
    }
    message.textContent = "Uploading…";
    report(
      message,
      api<PhotoUpload<UploadTicket>>(`/posts/${postId}/photos/upload-ticket`, { method: "POST", body: { contentType: file.type } })
        .then(async ({ id, ticket }) => {
          await uploadFile(ticket, file, {
            onProgress: (p) => {
              message.textContent = `Uploading… ${p.loaded} of ${p.total} bytes`;
            },
          });
          return api<StoredPhoto>(`/posts/${postId}/photos`, { method: "POST", body: { id } });
        })
        .then(() => window.location.reload()),
    );
  });

  const share = el("button", `Create share link (valid ${site.shareLinkDays} days)`);
  const shareOut = el("p");
  share.addEventListener("click", () => {
    report(
      message,
      api<ShareLink>(`/posts/${postId}/share`, { method: "POST" }).then((made) => {
        const url = `${window.location.origin}/share/${made.token}`;
        shareOut.replaceChildren(link(url, url), ` (expires ${when(made.expiresAt)})`);
      }),
    );
  });

  controls.append(title, el("br"), body, el("br"), save, el("hr"), picker, upload, el("hr"), share, shareOut);
  return controls;
}

function actionButton(label: string, message: HTMLElement, work: () => Promise<unknown>, after: () => void): HTMLButtonElement {
  const button = el("button", label);
  button.addEventListener("click", () => {
    report(message, work().then(after));
  });
  return button;
}

/** One post; its author edits a draft, attaches photos and makes share links; admins publish, unpublish and delete. */
export function postPage(postId: string, user: CurrentUser, site: SiteInfo): HTMLElement {
  const page = el("div");
  const message = el("p");
  page.append(message);
  report(
    message,
    api<PostDetail<DownloadTicket>>(`/posts/${postId}`).then((detail) => {
      page.prepend(render(detail));
      if (user.level === "anonymous") return;
      const ownDraft = detail.post.authorId === user.id && detail.post.status === "draft";
      if (ownDraft) page.append(authorControls(postId, detail, site, message));
      const actions = el("p");
      if (user.level === "admin") {
        const toggle = detail.post.status === "draft" ? "publish" : "unpublish";
        actions.append(actionButton(toggle === "publish" ? "Publish" : "Unpublish", message, () => api(`/posts/${postId}/${toggle}`, { method: "POST" }), () => window.location.reload()));
      }
      if (ownDraft || user.level === "admin") {
        actions.append(" ", actionButton("Delete post", message, () => api(`/posts/${postId}`, { method: "DELETE" }), () => window.location.assign("/")));
      }
      page.append(actions);
    }),
  );
  return page;
}

/** A draft opened through a share link. */
export function sharedPage(token: string): HTMLElement {
  const page = el("div");
  const message = el("p");
  page.append(message);
  report(
    message,
    api<PostDetail<DownloadTicket>>(`/shared/${encodeURIComponent(token)}`).then((detail) => {
      page.prepend(el("p", "Shared draft"), render(detail));
    }),
  );
  return page;
}
