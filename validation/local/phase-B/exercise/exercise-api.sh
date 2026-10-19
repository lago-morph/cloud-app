#!/bin/bash
# B-RUN exercise script: plain HTTP requests against a running `dev` server. Usage: exercise-api.sh <port>
# Prints each request and the response status/body (no secret values are ever returned by these routes).
P=$1
B=http://localhost:$P
J=$(mktemp)
c() { echo "\$ curl $*"; curl --noproxy '*' -sS -o /tmp/b-run-body -w "HTTP %{http_code} content-type=%{content_type}\n" "$@"; head -c 600 /tmp/b-run-body; echo; echo; }
c "$B/"
c "$B/api/hello"
c "$B/api/auth/me" -b $J -c $J
c "$B/api/notes" -b $J -c $J
c "$B/api/__framework/health"
c "$B/some/deep/link"
c "$B/" -H "Host: evil.example:$P"
c "$B/" -H "Host: 127.0.0.1:$P"
# Log in with the authentication mock as a user (Origin must match the public origin for state-changing requests).
c -X POST "$B/api/auth/mock-login" -H "Origin: $B" -H "content-type: application/json" -d '{"level":"user","id":"b-run-user","displayName":"B-RUN User"}' -b $J -c $J
c "$B/api/auth/me" -b $J -c $J
c -X POST "$B/api/notes" -H "Origin: $B" -H "content-type: application/json" -d '{"text":"note via curl"}' -b $J -c $J
c "$B/api/notes" -b $J -c $J
c -X POST "$B/api/notes" -H "Origin: http://evil.example" -H "content-type: application/json" -d '{"text":"forged"}' -b $J -c $J
c -X PUT "$B/api/status" -H "Origin: $B" -H "content-type: application/json" -d '{"status":"busy via curl"}' -b $J -c $J
c "$B/api/status" -b $J -c $J
c -X POST "$B/api/files/upload-ticket" -H "Origin: $B" -H "content-type: application/json" -d '{"name":"curl.txt","contentType":"text/plain"}' -b $J -c $J
c "$B/api/files" -b $J -c $J
c "$B/api/admin/secret" -b $J -c $J
c -X POST "$B/api/auth/mock-login" -H "Origin: $B" -H "content-type: application/json" -d '{"level":"admin","id":"b-run-admin"}' -b $J -c $J
c "$B/api/admin/secret" -b $J -c $J
c -X POST "$B/api/auth/logout" -H "Origin: $B" -b $J -c $J
c "$B/api/auth/me" -b $J -c $J
rm -f $J /tmp/b-run-body
