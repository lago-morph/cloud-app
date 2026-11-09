import { api, downloadUrl, uploadFile, type DownloadTicket, type UploadTicket } from "@lago-morph/prototype-framework/client";
import type { FileList, StoredFile } from "../../shared/types";
import { describeError, el, section } from "../dom";

/** Upload a file, finalize it, and download your files (FILES, through tickets). */
export function filesPage(): HTMLElement {
  const page = section("Files");
  const picker = el("input");
  picker.type = "file";
  const upload = el("button", "Upload");
  const message = el("p");
  const list = el("ul");
  page.append(picker, upload, message, list);

  async function download(id: string): Promise<void> {
    const { ticket } = await api<{ ticket: DownloadTicket }>("/files/download-ticket", { method: "POST", body: { id } });
    window.open(downloadUrl(ticket), "_blank", "noopener");
  }

  async function refresh(): Promise<void> {
    const { files } = await api<FileList>("/files");
    list.replaceChildren(
      ...files.map((f) => {
        const item = el("li", `${f.name} (${f.size} bytes) `);
        const button = el("button", "Download");
        button.addEventListener("click", () => {
          void download(f.id).catch((error: unknown) => {
            message.textContent = describeError(error);
          });
        });
        item.append(button);
        return item;
      }),
    );
  }

  upload.addEventListener("click", () => {
    const file = picker.files?.[0];
    if (file === undefined) {
      message.textContent = "Choose a file first.";
      return;
    }
    message.textContent = "Uploading…";
    const contentType = file.type === "" ? "application/octet-stream" : file.type;
    void api<{ id: string; ticket: UploadTicket }>("/files/upload-ticket", { method: "POST", body: { contentType } })
      .then(async ({ id, ticket }) => {
        await uploadFile(ticket, file, {
          onProgress: (p) => {
            message.textContent = `Uploading… ${p.loaded} of ${p.total} bytes`;
          },
        });
        return api<StoredFile>("/files/finalize", { method: "POST", body: { id, name: file.name } });
      })
      .then(() => {
        message.textContent = "Uploaded.";
        return refresh();
      })
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
  });

  void refresh().catch((error: unknown) => {
    message.textContent = describeError(error);
  });
  return page;
}
