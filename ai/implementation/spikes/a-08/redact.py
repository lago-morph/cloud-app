"""stdin -> stdout filter: removes the account ID, 32-hex IDs, ANSI codes, account names, bearer values."""
import os, re, sys

acct = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
for line in sys.stdin:
    if acct:
        line = line.replace(acct, "<account-id>")
    line = re.sub(r"[0-9a-f]{32}", "<hex32>", line)
    line = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", line)
    line = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}'s Account", "<account-name>", line)
    line = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._-]+", r"\1<redacted>", line)
    sys.stdout.write(line)
    sys.stdout.flush()
