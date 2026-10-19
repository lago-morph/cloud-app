#!/bin/sh
# Start `wrangler dev`, hit each endpoint, stop it. Run from the spike directory.
PORT=${PORT:-8799}
npx wrangler dev --port "$PORT" --ip 127.0.0.1 > "${LOG:-out/wrangler-dev.txt}" 2>&1 &
PID=$!
i=0
until curl -s -o /dev/null "http://127.0.0.1:$PORT/api/health"; do
  i=$((i+1)); [ "$i" -gt 60 ] && echo "dev did not start" && break; sleep 1
done
for p in health jwt sigv4 r2; do echo "GET /api/$p -> $(curl -s "http://127.0.0.1:$PORT/api/$p")"; done
echo "POST /api/notes -> $(curl -s -X POST -H 'content-type: application/json' -d '{"id":"1","title":"b","rank":1}' "http://127.0.0.1:$PORT/api/notes")"
echo "POST invalid -> HTTP $(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"id":"","title":1}' "http://127.0.0.1:$PORT/api/notes")"
kill "$PID"; wait "$PID" 2>/dev/null
echo "stopped"
