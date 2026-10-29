#!/usr/bin/env bash
# Run this worktree's API on :3100 against the local PGlite mirror.
# Reads SUPABASE_* and X402_* from ENV_FILE without printing them. DATABASE_URL is forced local.
# X402_MOCK=1 (default) mocks only chain submission; signatures are still verified.
set -euo pipefail
ENV_FILE=${ENV_FILE:-/workspace/idlebot/apps/api/.env.local}
set -a
# shellcheck disable=SC1090
source <(grep -E '^(SUPABASE_[A-Z_]*|X402_[A-Z_]*)=' "$ENV_FILE")
set +a
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${LOCAL_PG_PORT:-55432}/postgres
export X402_MOCK=${X402_MOCK:-1}
export BOUNTY_REVIEW_TIMEOUT_SEC=${BOUNTY_REVIEW_TIMEOUT_SEC:-60}
cd "$(dirname "$0")/.."
exec npx next dev -p "${PORT:-3100}" -H 127.0.0.1
