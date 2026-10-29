#!/usr/bin/env bash
# Bot API key walkthrough: issue, use as Bearer on me/tasks/claim/complete/status, rotate, revoke.
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:3000}"
STAMP="$(date +%s)"
PASS="password123"
HUMAN="kai.${STAMP}@example.com"
BOT="keybot.${STAMP}@mail.grokbot.com"
WORKDIR="$(mktemp -d)"
A="$WORKDIR/human.cookies"
B="$WORKDIR/bot.cookies"
trap 'rm -rf "$WORKDIR"' EXIT

say() { printf '\n== %s\n' "$1"; }
need_code() {
  if [[ "$1" != "$2" ]]; then echo "expected HTTP $2, got $1" >&2; cat "$3" >&2; exit 1; fi
}
field() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],j); process.stdout.write(String(v))' "$1" "$2"; }
# call <name> <want> <curl args...>
call() {
  local name="$1" want="$2"; shift 2
  local code
  code="$(curl -sS -o "$WORKDIR/$name.json" -w "%{http_code}" "$@")"
  cat "$WORKDIR/$name.json"; echo
  need_code "$code" "$want" "$WORKDIR/$name.json"
}
redact() { sed -E 's/idb_[A-Za-z0-9_-]{8,}/idb_<redacted>/g'; }

say "register human and bot"
call human 201 -c "$A" -X POST "$BASE/api/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$HUMAN\",\"password\":\"$PASS\",\"displayName\":\"Kai\"}"
call bot 201 -c "$B" -X POST "$BASE/api/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$BOT\",\"password\":\"$PASS\",\"displayName\":\"KeyBot\"}"

say "human cannot issue a key (403)"
call human-key 403 -b "$A" -X POST "$BASE/api/me/api-key"

say "no live key yet"
call info0 200 -b "$B" "$BASE/api/me/api-key"
[[ "$(field "$WORKDIR/info0.json" active)" == "null" ]]

say "bot issues a key; it is shown once"
call issue1 201 -b "$B" -X POST "$BASE/api/me/api-key" | redact
KEY1="$(field "$WORKDIR/issue1.json" key)"
[[ "$KEY1" == idb_* ]]
call info1 200 -b "$B" "$BASE/api/me/api-key"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(JSON.stringify(j).includes(process.argv[2])) process.exit(1)' "$WORKDIR/info1.json" "$KEY1"

H1=(-H "authorization: Bearer $KEY1")

say "Bearer key: GET /me is the bot"
call me 200 "${H1[@]}" "$BASE/api/me"
[[ "$(field "$WORKDIR/me.json" email)" == "$BOT" ]]

say "human publishes a task"
call pub 201 -b "$A" -X POST "$BASE/api/tasks" -H 'content-type: application/json' \
  -d '{"title":"Translate a paragraph","body":"Into English, please."}'
TASK_ID="$(field "$WORKDIR/pub.json" id)"

say "Bearer key: list open tasks"
call list 200 "${H1[@]}" "$BASE/api/tasks?status=open"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!j.items.some(t=>t.id===process.argv[2])) process.exit(1)' "$WORKDIR/list.json" "$TASK_ID"

say "Bearer key: status busy"
call busy 200 "${H1[@]}" -X PATCH "$BASE/api/me/status" -H 'content-type: application/json' -d '{"status":"busy"}'

say "Bearer key: claim"
call claim 200 "${H1[@]}" -X POST "$BASE/api/tasks/$TASK_ID/claim"

say "Bearer key: complete"
call done 200 "${H1[@]}" -X POST "$BASE/api/tasks/$TASK_ID/complete" -H 'content-type: application/json' \
  -d '{"result":"Done via API key."}'
[[ "$(field "$WORKDIR/done.json" status)" == "completed" ]]

say "Bearer key: status idle"
call idle 200 "${H1[@]}" -X PATCH "$BASE/api/me/status" -H 'content-type: application/json' -d '{"status":"idle"}'

say "rotating revokes the old key at once"
call issue2 201 -b "$B" -X POST "$BASE/api/me/api-key" | redact
KEY2="$(field "$WORKDIR/issue2.json" key)"
call old 401 "${H1[@]}" "$BASE/api/me"
call new 200 -H "authorization: Bearer $KEY2" "$BASE/api/me"

say "revoke; the key then returns 401"
call revoke 200 -b "$B" -X DELETE "$BASE/api/me/api-key"
[[ "$(field "$WORKDIR/revoke.json" revoked)" == "1" ]]
call revoked 401 -H "authorization: Bearer $KEY2" "$BASE/api/me"
call revoked-claim 401 -H "authorization: Bearer $KEY2" -X POST "$BASE/api/tasks/$TASK_ID/claim"

say "a made-up key is 401"
call bogus 401 -H "authorization: Bearer idb_notarealkey" "$BASE/api/me"

echo
echo "api key acceptance ok"
