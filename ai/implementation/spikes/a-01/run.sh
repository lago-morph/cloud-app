#!/usr/bin/env bash
# Usage: run.sh <label> <command...>
# Runs a command from the spike directory, captures stdout+stderr to logs/<label>.txt,
# with the account ID redacted. Never echoes environment values.
set -u
cd "$(dirname "$0")"
mkdir -p logs
label="$1"; shift
export PATH="$PWD/node_modules/.bin:$PATH"
timeout "${RUN_TIMEOUT:-180}" "$@" > "logs/$label.raw" 2>&1 < /dev/null
code=$?
sed -E "s/${CLOUDFLARE_ACCOUNT_ID}/<account-id>/g; s/[0-9a-f]{32}/<hex32>/g; s/\x1b\[[0-9;]*[A-Za-z]//g" "logs/$label.raw" > "logs/$label.txt"
rm -f "logs/$label.raw"
echo "exit=$code" >> "logs/$label.txt"
tail -n "${TAIL:-40}" "logs/$label.txt"
