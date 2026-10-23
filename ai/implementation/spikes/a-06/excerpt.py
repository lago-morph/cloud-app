"""Write logs/dump-excerpt.txt: the non-INSERT lines and the edge-case rows of the export dump, each cut at
160 characters with control bytes made visible. Usage: python3 -I excerpt.py <dump.sql>"""
import os, re, sys

data = open(sys.argv[1], "rb").read()
lines = data.split(b"\n")
pat = re.compile(rb"e00[1-8]|self_ref|cyc_|__framework|x_extras|sqlite_sequence|big_text|'q000[01]'")
out = [f"# Excerpt of the D1 export of spikecmmrxula-a06-src ({len(data)} bytes, {len(lines)} lines). "
       "Format: <line no>: <text cut at 160 chars, control bytes as \\xNN> [bytes=<line length>]"]
for i, ln in enumerate(lines, 1):
    if i <= 3 or not ln.startswith(b"INSERT") or pat.search(ln):
        text = ln[:160].decode("utf-8", "replace")
        text = "".join(c if c >= " " or c == "\t" else f"\\x{ord(c):02x}" for c in text)
        out.append(f"{i}: {text} [bytes={len(ln)}]")
here = os.path.dirname(os.path.abspath(__file__))
open(os.path.join(here, "logs", "dump-excerpt.txt"), "w").write("\n".join(out) + "\n")
print(len(out), "lines written")
