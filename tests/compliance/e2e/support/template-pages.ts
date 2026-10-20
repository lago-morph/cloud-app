/**
 * E2E-001 step 2, run inside the offline network namespace (`unshare -rn sh scripts/offline.sh
 * node <this file> <appDir>`): starts `dev` for a scaffolded app, then uses each capability
 * through the template's pages in Chromium, and prints one JSON line `E2E-001-RESULT {…}`.
 * Runs with Node's type stripping, so it imports only packages (no relative imports).
 *
 * Capabilities and the template pages that use them:
 * - CFG: the heading shows the configured greeting (set in config/local.json by the test);
 * - AUTH: "Log in" (the mock's default user locally) and "Log out"; an admin via mock-login;
 * - SQL: Notes ("Add" lists the note); KV: Status ("Save", kept after a reload);
 * - FILES: Files ("Upload" lists the file; "Download" returns the same bytes);
 * - SEC: Admin "Check secret" says the secret is set (set with `secrets set` by the test);
 * - LOG: the note's log entry in `.logs/` (checked by the caller).
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const appDir = process.argv[2];
const greeting = process.argv[3] ?? "";
if (appDir === undefined) throw new Error("usage: template-pages <appDir> <greeting>");

const steps: { step: string; ok: boolean; detail?: string }[] = [];
const record = (step: string, ok: boolean, detail?: string): void => {
  steps.push(detail === undefined ? { step, ok } : { step, ok, detail });
};

function startDev(): Promise<{ origin: string; stop: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--no-install", "prototype-framework", "dev"], { cwd: appDir, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let output = "";
    let done = false;
    const stop = async (): Promise<string> => {
      if (child.exitCode === null) {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, "SIGINT");
        } catch {
          // gone
        }
        await new Promise<void>((r) => {
          const timer = setTimeout(() => {
            try {
              if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
            } catch {
              // gone
            }
            r();
          }, 20_000);
          child.on("close", () => {
            clearTimeout(timer);
            r();
          });
        });
      }
      return output;
    };
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        void stop().then(() => reject(new Error(`dev did not start within 180 s:\n${output.slice(-2000)}`)));
      }
    }, 180_000);
    const take = (c: Buffer): void => {
      output += c.toString("utf8");
      const m = /is running at (http:\/\/localhost:\d+)\//.exec(output);
      if (m?.[1] !== undefined && !done) {
        done = true;
        clearTimeout(timer);
        resolve({ origin: m[1], stop });
      }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("close", (code) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(new Error(`dev exited with ${String(code)}:\n${output.slice(-2000)}`));
      }
    });
  });
}

async function section(page: Page, title: string) {
  return page.locator("section", { has: page.getByRole("heading", { name: title, exact: true }) });
}

async function check(step: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    record(step, true);
  } catch (error) {
    record(step, false, error instanceof Error ? error.message.split("\n").slice(0, 6).join(" | ") : String(error));
  }
}

const dev = await startDev();
let devOutput = "";
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const T = { timeout: 20_000 };
  await page.goto(dev.origin);

  await check("CFG: the page shows the configured greeting", async () => {
    await page.getByRole("heading", { level: 1, name: greeting, exact: true }).waitFor(T);
  });
  await check("AUTH: log in through the account page", async () => {
    await page.getByRole("button", { name: "Log in" }).click();
    await page.getByText(/Logged in as .* \(user\)\./).waitFor(T);
  });
  const note = `note ${Date.now().toString(36)}`;
  await check("SQL: add a note and see it listed", async () => {
    const notes = await section(page, "Notes");
    await notes.getByPlaceholder("Write a note").fill(note);
    await notes.getByRole("button", { name: "Add" }).click();
    await notes.getByText(note).waitFor(T);
  });
  const status = `status ${Date.now().toString(36)}`;
  await check("KV: save a status and read it back after a reload", async () => {
    const statusSection = await section(page, "Status");
    await statusSection.getByPlaceholder("Your status").fill(status);
    await statusSection.getByRole("button", { name: "Save" }).click();
    await statusSection.getByText("Saved.").waitFor(T);
    await page.reload();
    const again = await section(page, "Status");
    await again.getByPlaceholder("Your status").waitFor(T);
    const value = await again.getByPlaceholder("Your status").inputValue();
    if (value !== status) {
      // The page fills the input once its request answers.
      await page.waitForFunction((expected) => [...document.querySelectorAll("input")].some((i) => i.value === expected), status, T);
    }
  });
  const content = `e2e-001 file ${Date.now().toString(36)}\n`;
  await check("FILES: upload a file, see it listed, download the same bytes", async () => {
    const files = await section(page, "Files");
    await files.locator('input[type="file"]').setInputFiles({ name: "e2e-001.txt", mimeType: "text/plain", buffer: Buffer.from(content, "utf8") });
    await files.getByRole("button", { name: "Upload" }).click();
    await files.getByText("Uploaded.").waitFor(T);
    const item = files.getByRole("listitem").filter({ hasText: "e2e-001.txt" });
    await item.waitFor(T);
    const [popup] = await Promise.all([context.waitForEvent("page", T), item.getByRole("button", { name: "Download" }).click()]);
    let body: string;
    const download = await popup.waitForEvent("download", { timeout: 10_000 }).catch(() => undefined);
    if (download !== undefined) {
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
      body = Buffer.concat(chunks).toString("utf8");
    } else {
      await popup.waitForLoadState("load", T);
      body = await popup.evaluate(() => document.body.innerText);
    }
    if (body.trim() !== content.trim()) throw new Error(`downloaded ${JSON.stringify(body.slice(0, 80))}, uploaded ${JSON.stringify(content)}`);
    await popup.close();
  });
  await check("AUTH: log out through the account page", async () => {
    await page.bringToFront();
    await page.getByRole("button", { name: "Log out" }).click();
    await page.getByText("You are not logged in.").waitFor(T);
  });
  await check("SEC: as an admin, the admin page says the secret is set", async () => {
    const status = await page.evaluate(async () => {
      const r = await fetch("/api/auth/mock-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level: "admin" }) });
      return r.status;
    });
    if (status !== 204) throw new Error(`mock-login as admin answered ${String(status)}`);
    await page.reload();
    const admin = await section(page, "Admin");
    await admin.getByRole("button", { name: "Check secret" }).click();
    await admin.getByText("The secret apiKey is set.").waitFor(T);
  });
  await context.close();
} finally {
  await browser.close();
  devOutput = await dev.stop();
}
const devFailed = /\bERROR\b|Uncaught/.test(devOutput) ? devOutput.split("\n").filter((l) => /\bERROR\b|Uncaught/.test(l)).slice(0, 5) : [];
process.stdout.write(`E2E-001-RESULT ${JSON.stringify({ steps, devErrors: devFailed })}\n`);
