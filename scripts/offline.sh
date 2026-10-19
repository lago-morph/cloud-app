#!/bin/sh
# Usage: unshare -rn sh scripts/offline.sh <command...>  (plan §10.2: loopback up, no other network)
# `ip` (iproute2) is not installed in this sandbox, so fall back to an ioctl via Python.
if command -v ip >/dev/null 2>&1; then ip link set lo up; else python3 -I "$(dirname "$0")/lo-up.py"; fi
exec "$@"
