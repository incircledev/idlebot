#!/usr/bin/env bash
# Bounty P0 acceptance against a LOCAL API (scripts/dev-bounty-local.sh, X402_MOCK=1,
# BOUNTY_REVIEW_TIMEOUT_SEC=60). Needs the test API keys from scripts/seed-bounty-local.ts
# in $KEYS and X402_PUBLISHER_PRIVATE_KEY in the environment (never printed).
set -euo pipefail
BASE="${BASE:-http://127.0.0.1:3100}"
KEYS="${KEYS:-/tmp/idlebot-bounty-keys.env}"
# shellcheck disable=SC1090
source "$KEYS"
cd "$(dirname "$0")/.."
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
PASSES=0

say() { printf '\n== %s\n' "$1"; }
# call <who-key> <METHOD> <path> [json] -> prints "< status" and body; sets $CODE and $W/last.json
call() {
  local key="$1" method="$2" path="$3" data="${4:-}"
  local args=(-sS -o "$W/last.json" -w "%{http_code}" -X "$method" "$BASE$path" -H "Authorization: Bearer $key")
  [[ -n "$data" ]] && args+=(-H 'content-type: application/json' -d "$data")
  printf '> %s %s %s\n' "$method" "$path" "$data"
  CODE="$(curl "${args[@]}")"
  printf '< %s ' "$CODE"; cat "$W/last.json"; echo
}
want() { if [[ "$CODE" != "$1" ]]; then echo "FAIL: expected $1, got $CODE" >&2; exit 1; fi; PASSES=$((PASSES+1)); }
field() { jq -r "$1" "$W/last.json"; }
check() { local got; got="$(field "$1")"; if [[ "$got" != "$2" ]]; then echo "FAIL: $1 = $got, want $2" >&2; exit 1; fi; PASSES=$((PASSES+1)); }
publish_paid() { # <title> <bounty> -> sets TASK
  npx tsx scripts/x402-pay.ts "$BASE/api/tasks" "$KEY_PUBLISHER" "{\"title\":\"$1\",\"body\":\"验收脚本\",\"bounty\":\"$2\"}" | tee "$W/pay.txt"
  TASK="$(tail -1 "$W/pay.txt" | jq -r .id)"
  [[ "$TASK" =~ ^[0-9a-f-]{36}$ ]] || { echo "FAIL: publish" >&2; exit 1; }
  PASSES=$((PASSES+1))
}

say "1a. bounty validation (before any payment)"
call "$KEY_PUBLISHER" POST /api/tasks '{"title":"t","body":"b","bounty":"0.001"}'; want 400
call "$KEY_PUBLISHER" POST /api/tasks '{"title":"t","body":"b","bounty":"100.01"}'; want 400
call "$KEY_PUBLISHER" POST /api/tasks '{"title":"免费任务","body":"不带赏金","bounty":"0"}'; want 201; check .bounty null; check .status open

say "1b. bounty task without payment -> 402, nothing created"
call "$KEY_PUBLISHER" POST /api/tasks '{"title":"未付款","body":"b","bounty":"5"}'; want 402
check '.accepts[0].amount' 5000000; check '.accepts[0].network' eip155:84532

say "1c. pay with x402 (PAYMENT-SIGNATURE) -> 201 open"
publish_paid "整理 30 条用户反馈" 5; T1="$TASK"

say "6. claiming a bounty task without a wallet -> 400 wallet_required"
call "$KEY_NOWALLET" POST "/api/tasks/$T1/claim"; want 400; check .code wallet_required

say "6b. wallet validation on PATCH /api/me"
call "$KEY_NOWALLET" PATCH /api/me '{"walletAddress":"0x1234"}'; want 400
call "$KEY_BOT01" GET /api/me; want 200; check .walletAddress 0xfea2B3ECf7287c6583DaE820B2a46F8Ef2F18ea2

say "2. claim -> submit -> pending_review"
call "$KEY_BOT01" POST "/api/tasks/$T1/claim"; want 200; check .status in_progress
call "$KEY_BOT01" POST "/api/tasks/$T1/complete" '{"result":"v1"}'; want 200; check .status pending_review

say "3. reject: reason required, max 2, back to in_progress"
call "$KEY_BOT01" POST "/api/tasks/$T1/reject" '{"reason":"自己驳回"}'; want 403
call "$KEY_PUBLISHER" POST "/api/tasks/$T1/reject" '{"reason":"  "}'; want 400
call "$KEY_PUBLISHER" POST "/api/tasks/$T1/reject" '{"reason":"分类太粗"}'; want 200; check .status in_progress; check .rejectCount 1
call "$KEY_BOT01" POST "/api/tasks/$T1/complete" '{"result":"v2"}'; want 200; check .status pending_review
call "$KEY_PUBLISHER" POST "/api/tasks/$T1/reject" '{"reason":"缺原话"}'; want 200; check .rejectCount 2
call "$KEY_BOT01" POST "/api/tasks/$T1/complete" '{"result":"v3"}'; want 200; check .status pending_review
call "$KEY_PUBLISHER" POST "/api/tasks/$T1/reject" '{"reason":"第三次"}'; want 409

say "4. two concurrent accepts -> one payout"
for i in 1 2 3; do
  curl -sS -o "$W/acc$i.json" -w "accept#$i < %{http_code}\n" -X POST "$BASE/api/tasks/$T1/accept" -H "Authorization: Bearer $KEY_PUBLISHER" &
done
wait
for i in 1 2 3; do jq -c '{status,payoutStatus}' "$W/acc$i.json"; done
call "$KEY_PUBLISHER" GET "/api/tasks/$T1/receipt"; want 200
check '[.items[] | select(.kind=="payout")] | length' 1
check '[.items[] | select(.kind=="payment")] | length' 1
check '.items[] | select(.kind=="payout") | .to' 0xfea2B3ECf7287c6583DaE820B2a46F8Ef2F18ea2
call "$KEY_PUBLISHER" POST "/api/tasks/$T1/accept"; want 200; check .payoutStatus paid

say "5. cancel an unclaimed bounty task -> refund (idempotent)"
publish_paid "临时任务，稍后取消" 2; T2="$TASK"
call "$KEY_BOT01" POST "/api/tasks/$T2/cancel"; want 403
call "$KEY_PUBLISHER" POST "/api/tasks/$T2/cancel"; want 200; check .status cancelled; check .payoutStatus refunded
call "$KEY_PUBLISHER" POST "/api/tasks/$T2/cancel"; want 200
call "$KEY_PUBLISHER" GET "/api/tasks/$T2/receipt"; want 200
check '[.items[] | select(.kind=="refund")] | length' 1
check '.items[] | select(.kind=="refund") | .to' 0xcDe8FeDDd548DB895eaBB40F4A82e094DF952667
call "$KEY_BOT01" POST "/api/tasks/$T2/claim"; want 409
call "$KEY_PUBLISHER" POST "/api/tasks/$T1/cancel"; want 409

say "4b. auto-accept after BOUNTY_REVIEW_TIMEOUT_SEC (lazy, on read)"
publish_paid "自动验收测试" 3; T3="$TASK"
call "$KEY_BOT02" POST "/api/tasks/$T3/claim"; want 200
call "$KEY_BOT02" POST "/api/tasks/$T3/complete" '{"result":"done"}'; want 200; check .status pending_review
echo "autoAcceptAt=$(field .autoAcceptAt); sleeping ${WAIT_SEC:-65}s"
sleep "${WAIT_SEC:-65}"
call "$KEY_BOT02" GET "/api/tasks/$T3"; want 200; check .status completed; check .payoutStatus paid

say "status filters"
call "$KEY_PUBLISHER" GET "/api/tasks?status=pending_review"; want 200
call "$KEY_PUBLISHER" GET "/api/tasks?status=cancelled"; want 200
call "$KEY_PUBLISHER" GET "/api/tasks?status=bogus"; want 400

printf '\nALL PASS (%d checks)\n' "$PASSES"
