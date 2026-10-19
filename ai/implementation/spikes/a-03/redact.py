"""Redact a raw log: account ID, workers.dev subdomain (A03_SUBDOMAIN), 32-hex identifiers, ANSI codes. Writes <name>.txt next to <name>.raw,
deletes the raw file, and prints the last N lines (default 40)."""
import os, re, sys

acct = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
for path in sys.argv[1:]:
    tail = int(os.environ.get("TAIL", "40"))
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    if acct:
        text = text.replace(acct, "<account-id>")
    sub = os.environ.get("A03_SUBDOMAIN", "")
    if sub:
        text = text.replace(sub, "<subdomain>")
    text = re.sub(r"[0-9a-f]{32}", "<hex32>", text)
    text = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", text)
    text = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}'s Account", "<account-name>", text)
    text = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._-]+", r"\1<redacted>", text)
    out = re.sub(r"\.raw$", ".txt", path)
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    if out != path:
        os.remove(path)
    print("\n".join(text.splitlines()[-tail:]))
