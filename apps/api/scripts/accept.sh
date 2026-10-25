#!/usr/bin/env bash
# Cookie-session walkthrough: register, publish, claim, mock-complete.
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:3000}"
STAMP="$(date +%s)"
PASS="password123"
HUMAN="ada.${STAMP}@example.com"
BOT="porter.${STAMP}@mail.grokbot.com"
BAD="porter.${STAMP}@grokbot.com"
WORKDIR="$(mktemp -d)"
A="$WORKDIR/human.cookies"
B="$WORKDIR/bot.cookies"
trap 'rm -rf "$WORKDIR"' EXIT

say() { printf '\n== %s\n' "$1"; }

need_code() {
  local got="$1" want="$2" file="$3"
  if [[ "$got" != "$want" ]]; then
    echo "expected HTTP $want, got $got" >&2
    cat "$file" >&2
    exit 1
  fi
}

say "reject a bot-shaped email that is not @mail.grokbot.com"
code="$(curl -sS -o "$WORKDIR/bad.json" -w "%{http_code}" \
  -X POST "$BASE/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$BAD\",\"password\":\"$PASS\",\"displayName\":\"Nope\"}")"
cat "$WORKDIR/bad.json"; echo
need_code "$code" 400 "$WORKDIR/bad.json"

say "register human"
code="$(curl -sS -c "$A" -o "$WORKDIR/human.json" -w "%{http_code}" \
  -X POST "$BASE/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$HUMAN\",\"password\":\"$PASS\",\"displayName\":\"Ada\"}")"
cat "$WORKDIR/human.json"; echo
need_code "$code" 201 "$WORKDIR/human.json"

say "register bot"
code="$(curl -sS -c "$B" -o "$WORKDIR/bot.json" -w "%{http_code}" \
  -X POST "$BASE/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$BOT\",\"password\":\"$PASS\",\"displayName\":\"Porter\"}")"
cat "$WORKDIR/bot.json"; echo
need_code "$code" 201 "$WORKDIR/bot.json"
node -e 'const u=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).user; if(u.kind!=="bot"||u.status!=="idle") process.exit(1)' "$WORKDIR/bot.json"

say "login human into a fresh cookie jar"
code="$(curl -sS -c "$A" -o "$WORKDIR/login.json" -w "%{http_code}" \
  -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$HUMAN\",\"password\":\"$PASS\"}")"
cat "$WORKDIR/login.json"; echo
need_code "$code" 200 "$WORKDIR/login.json"

say "GET /api/me"
curl -sS -b "$A" "$BASE/api/me"; echo

say "human publishes a task"
code="$(curl -sS -b "$A" -o "$WORKDIR/task.json" -w "%{http_code}" \
  -X POST "$BASE/api/tasks" \
  -H 'content-type: application/json' \
  -d '{"title":"Summarize the stand-up","body":"Three bullets, no fluff."}')"
cat "$WORKDIR/task.json"; echo
need_code "$code" 201 "$WORKDIR/task.json"
TASK_ID="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).id)' "$WORKDIR/task.json")"

say "bot lists the open board"
curl -sS -b "$B" "$BASE/api/tasks?status=open"; echo

say "reject an unsupported status filter"
code="$(curl -sS -b "$B" -o "$WORKDIR/bad-status.json" -w "%{http_code}" \
  "$BASE/api/tasks?status=done")"
cat "$WORKDIR/bad-status.json"; echo
need_code "$code" 400 "$WORKDIR/bad-status.json"
node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8"); if (/"status"\s*:\s*"done"/.test(t)) process.exit(1)' "$WORKDIR/bad-status.json"

say "bot claims; status becomes in_progress and an assignment email is logged"
code="$(curl -sS -b "$B" -o "$WORKDIR/claim.json" -w "%{http_code}" \
  -X POST "$BASE/api/tasks/$TASK_ID/claim")"
cat "$WORKDIR/claim.json"; echo
need_code "$code" 200 "$WORKDIR/claim.json"
node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(t.status!=="in_progress") process.exit(1)' "$WORKDIR/claim.json"

say "relay log for the bot claim"
curl -sS -b "$B" -o "$WORKDIR/relay.json" "$BASE/api/relay/logs?taskId=$TASK_ID"
cat "$WORKDIR/relay.json"; echo
node -e '
const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const id=process.argv[2];
const row=(j.items||[]).find(i=>i.direction==="outbound");
if(!row) process.exit(1);
if(row.subject!==`[SharedBot][task:${id}] Summarize the stand-up`) process.exit(1);
if(!row.body.includes(`Reply-Task-Id: ${id}`)) process.exit(1);
' "$WORKDIR/relay.json" "$TASK_ID"

say "mock-complete writes status completed and a readable result"
code="$(curl -sS -b "$B" -o "$WORKDIR/completed.json" -w "%{http_code}" \
  -X POST "$BASE/api/relay/mock-complete" \
  -H 'content-type: application/json' \
  -d "{\"taskId\":\"$TASK_ID\",\"result\":\"Stand-up: shipped the board, claimed first, mailed the bot.\"}")"
cat "$WORKDIR/completed.json"; echo
need_code "$code" 200 "$WORKDIR/completed.json"
node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(t.status!=="completed"||!t.result) process.exit(1)' "$WORKDIR/completed.json"
RESULT='Stand-up: shipped the board, claimed first, mailed the bot.'
COMPLETED_AT="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).completedAt)' "$WORKDIR/completed.json")"

say "second identical mock-complete is 200 and does not rewrite completedAt"
code="$(curl -sS -b "$B" -o "$WORKDIR/completed-again.json" -w "%{http_code}" \
  -X POST "$BASE/api/relay/mock-complete" \
  -H 'content-type: application/json' \
  -d "{\"taskId\":\"$TASK_ID\",\"result\":\"$RESULT\"}")"
cat "$WORKDIR/completed-again.json"; echo
need_code "$code" 200 "$WORKDIR/completed-again.json"
node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(t.status!=="completed"||t.result!==process.argv[2]||t.completedAt!==process.argv[3]) process.exit(1)' \
  "$WORKDIR/completed-again.json" "$RESULT" "$COMPLETED_AT"

say "same result via POST /tasks/:id/complete is 200 and keeps completedAt"
code="$(curl -sS -b "$B" -o "$WORKDIR/completed-alias.json" -w "%{http_code}" \
  -X POST "$BASE/api/tasks/$TASK_ID/complete" \
  -H 'content-type: application/json' \
  -d "{\"result\":\"$RESULT\"}")"
cat "$WORKDIR/completed-alias.json"; echo
need_code "$code" 200 "$WORKDIR/completed-alias.json"
node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(t.completedAt!==process.argv[2]) process.exit(1)' \
  "$WORKDIR/completed-alias.json" "$COMPLETED_AT"

say "a different result on a completed task is 409 and keeps completedAt"
code="$(curl -sS -b "$B" -o "$WORKDIR/completed-conflict.json" -w "%{http_code}" \
  -X POST "$BASE/api/relay/mock-complete" \
  -H 'content-type: application/json' \
  -d "{\"taskId\":\"$TASK_ID\",\"result\":\"A different writeup.\"}")"
cat "$WORKDIR/completed-conflict.json"; echo
need_code "$code" 409 "$WORKDIR/completed-conflict.json"
node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(t.status!=="completed"&&!String(t.error||"").includes("completed")) process.exit(1)' \
  "$WORKDIR/completed-conflict.json"
curl -sS -b "$A" -o "$WORKDIR/completed-still.json" "$BASE/api/tasks/$TASK_ID"
node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(t.result!==process.argv[2]||t.completedAt!==process.argv[3]) process.exit(1)' \
  "$WORKDIR/completed-still.json" "$RESULT" "$COMPLETED_AT"

say "complete with no new result returns 200 and keeps completedAt"
code="$(curl -sS -b "$B" -o "$WORKDIR/completed-empty.json" -w "%{http_code}" \
  -X POST "$BASE/api/tasks/$TASK_ID/complete" \
  -H 'content-type: application/json' \
  -d '{}')"
cat "$WORKDIR/completed-empty.json"; echo
need_code "$code" 200 "$WORKDIR/completed-empty.json"
node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(t.completedAt!==process.argv[2]||t.result!==process.argv[3]) process.exit(1)' \
  "$WORKDIR/completed-empty.json" "$COMPLETED_AT" "$RESULT"

say "publisher can read the completed task"
curl -sS -b "$A" "$BASE/api/tasks/$TASK_ID"; echo

say "claiming again is a 409"
code="$(curl -sS -b "$A" -o "$WORKDIR/again.json" -w "%{http_code}" \
  -X POST "$BASE/api/tasks/$TASK_ID/claim")"
cat "$WORKDIR/again.json"; echo
need_code "$code" 409 "$WORKDIR/again.json"

say "bot publishes, human claims, no outbound mail, then complete alias"
code="$(curl -sS -b "$B" -o "$WORKDIR/task2.json" -w "%{http_code}" \
  -X POST "$BASE/api/tasks" \
  -H 'content-type: application/json' \
  -d '{"title":"File the notes","body":"Leave them on the desk."}')"
need_code "$code" 201 "$WORKDIR/task2.json"
TASK2="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).id)' "$WORKDIR/task2.json")"
code="$(curl -sS -b "$A" -o "$WORKDIR/human-claim.json" -w "%{http_code}" \
  -X POST "$BASE/api/tasks/$TASK2/claim")"
cat "$WORKDIR/human-claim.json"; echo
need_code "$code" 200 "$WORKDIR/human-claim.json"
curl -sS -b "$A" -o "$WORKDIR/human-relay.json" "$BASE/api/relay/logs?taskId=$TASK2"
cat "$WORKDIR/human-relay.json"; echo
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if((j.items||[]).some(i=>i.direction==="outbound")) process.exit(1)' "$WORKDIR/human-relay.json"
code="$(curl -sS -b "$A" -o "$WORKDIR/complete.json" -w "%{http_code}" \
  -X POST "$BASE/api/tasks/$TASK2/complete" \
  -H 'content-type: application/json' \
  -d '{"result":"Notes are on the desk."}')"
cat "$WORKDIR/complete.json"; echo
need_code "$code" 200 "$WORKDIR/complete.json"
node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(t.status!=="completed") process.exit(1)' "$WORKDIR/complete.json"

say "bot can mark busy"
curl -sS -b "$B" -X PATCH "$BASE/api/me/status" -H 'content-type: application/json' -d '{"status":"busy"}'; echo

say "human cannot set bot status"
code="$(curl -sS -b "$A" -o "$WORKDIR/human-status.json" -w "%{http_code}" \
  -X PATCH "$BASE/api/me/status" \
  -H 'content-type: application/json' \
  -d '{"status":"busy"}')"
cat "$WORKDIR/human-status.json"; echo
need_code "$code" 403 "$WORKDIR/human-status.json"

say "inbound webhook is 503 until INBOUND_EMAIL_SECRET is set"
code="$(curl -sS -o "$WORKDIR/inbound.json" -w "%{http_code}" \
  -X POST "$BASE/api/webhooks/inbound-email" \
  -H 'content-type: application/json' \
  -d '{"subject":"hello","body":"hello"}')"
cat "$WORKDIR/inbound.json"; echo
need_code "$code" 503 "$WORKDIR/inbound.json"

say "completing a task that is still open is 409"
code="$(curl -sS -b "$A" -o "$WORKDIR/open-task.json" -w "%{http_code}" \
  -X POST "$BASE/api/tasks" \
  -H 'content-type: application/json' \
  -d '{"title":"Leave this open","body":"Do not claim it."}')"
need_code "$code" 201 "$WORKDIR/open-task.json"
OPEN_ID="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).id)' "$WORKDIR/open-task.json")"
code="$(curl -sS -b "$A" -o "$WORKDIR/open-complete.json" -w "%{http_code}" \
  -X POST "$BASE/api/tasks/$OPEN_ID/complete" \
  -H 'content-type: application/json' \
  -d '{"result":"too soon"}')"
cat "$WORKDIR/open-complete.json"; echo
need_code "$code" 409 "$WORKDIR/open-complete.json"
node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(t.status!=="open"&&!String(t.error||"").includes("open")) process.exit(1)' \
  "$WORKDIR/open-complete.json"

say "two sessions claim one open task: exactly one 200 and one 409"
code="$(curl -sS -b "$B" -o "$WORKDIR/race-task.json" -w "%{http_code}" \
  -X POST "$BASE/api/tasks" \
  -H 'content-type: application/json' \
  -d '{"title":"Race the claim","body":"Only one assignee."}')"
need_code "$code" 201 "$WORKDIR/race-task.json"
RACE_ID="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).id)' "$WORKDIR/race-task.json")"
curl -sS -b "$A" -o "$WORKDIR/race-a.json" -w "%{http_code}" -X POST "$BASE/api/tasks/$RACE_ID/claim" >"$WORKDIR/race-a.code" &
pid_a=$!
curl -sS -b "$B" -o "$WORKDIR/race-b.json" -w "%{http_code}" -X POST "$BASE/api/tasks/$RACE_ID/claim" >"$WORKDIR/race-b.code" &
pid_b=$!
wait "$pid_a"
wait "$pid_b"
echo "claim A $(cat "$WORKDIR/race-a.code")"; cat "$WORKDIR/race-a.json"; echo
echo "claim B $(cat "$WORKDIR/race-b.code")"; cat "$WORKDIR/race-b.json"; echo
node -e '
const fs=require("fs");
const codes=[fs.readFileSync(process.argv[1],"utf8").trim(), fs.readFileSync(process.argv[2],"utf8").trim()].sort();
if(codes.join(",")!=="200,409") { console.error(codes); process.exit(1); }
' "$WORKDIR/race-a.code" "$WORKDIR/race-b.code"
curl -sS -b "$A" -o "$WORKDIR/race-got.json" "$BASE/api/tasks/$RACE_ID"
node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(t.status!=="in_progress"||!t.assigneeId) process.exit(1)' \
  "$WORKDIR/race-got.json"

say "CORS preflight for a localhost frontend"
curl -sS -D "$WORKDIR/cors.headers" -o /dev/null -X OPTIONS "$BASE/api/tasks" \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
cat "$WORKDIR/cors.headers"
grep -i "access-control-allow-origin: http://localhost:3000" "$WORKDIR/cors.headers" >/dev/null
grep -i "access-control-allow-credentials: true" "$WORKDIR/cors.headers" >/dev/null

say "CORS preflight for the Vite origin on 127.0.0.1:5190"
curl -sS -D "$WORKDIR/cors-5190.headers" -o /dev/null -X OPTIONS "$BASE/api/tasks" \
  -H "Origin: http://127.0.0.1:5190" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
grep -i "access-control-allow-origin: http://127.0.0.1:5190" "$WORKDIR/cors-5190.headers" >/dev/null
grep -i "access-control-allow-credentials: true" "$WORKDIR/cors-5190.headers" >/dev/null

echo
echo "acceptance ok"
