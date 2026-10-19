import { z } from "zod";

const Health = z.object({ ok: z.boolean() });
const el = document.getElementById("status");

void fetch("/api/health")
  .then((r) => r.json())
  .then((j: unknown) => {
    if (el) el.textContent = Health.parse(j).ok ? "api ok" : "api bad";
  });
