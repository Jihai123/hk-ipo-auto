#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3010}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"
SCORE_CODE="${1:-03355}"

log(){ echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

require_cmd(){
  command -v "$1" >/dev/null 2>&1 || { echo "missing command: $1"; exit 1; }
}

require_cmd node
require_cmd npm
require_cmd curl

require_cmd jq

extract_json(){
  local json="$1"
  local expr="$2"
  printf '%s' "$json" | jq -r "$expr"
}

http_get(){
  local path="$1"
  curl -sS --max-time 20 "${BASE_URL}${path}"
}

wait_server(){
  local retries=30
  for i in $(seq 1 "$retries"); do
    if curl -sS --max-time 2 "${BASE_URL}/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

cleanup(){
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

cd "$ROOT_DIR"
log "install check: npm deps"
npm install --silent >/dev/null

log "start server on port ${PORT}"
PORT="$PORT" node server.js >/tmp/hk-ipo-auto-check.log 2>&1 &
SERVER_PID=$!

if ! wait_server; then
  log "server failed to start; tail logs:"
  tail -n 80 /tmp/hk-ipo-auto-check.log || true
  exit 2
fi

log "probe /api/dashboard"
DASHBOARD_JSON="$(http_get '/api/dashboard?sort=score')"
DB_SUCCESS="$(extract_json "$DASHBOARD_JSON" '.success // false')"
TOP3_COUNT="$(extract_json "$DASHBOARD_JSON" '.top3 | if type=="array" then length else 0 end')"
LEADERBOARD_COUNT="$(extract_json "$DASHBOARD_JSON" '.leaderboard | if type=="array" then length else 0 end')"

log "probe /api/score/${SCORE_CODE}"
SCORE_JSON="$(http_get "/api/score/${SCORE_CODE}")"
SCORE_SUCCESS="$(extract_json "$SCORE_JSON" '.success // false')"
SCORE_TOTAL="$(extract_json "$SCORE_JSON" '.totalScore // ""')"
SCORE_RATING="$(extract_json "$SCORE_JSON" '.rating // ""')"
SCORE_ERROR="$(extract_json "$SCORE_JSON" '.error // ""')"

log "probe /api/ipo/top"
TOP_JSON="$(http_get '/api/ipo/top?limit=3')"
TOP_COUNT="$(extract_json "$TOP_JSON" '.ipos | if type=="array" then length else 0 end')"

log "probe /api/ipo/current"
CURRENT_JSON="$(http_get '/api/ipo/current')"
SUB_COUNT="$(extract_json "$CURRENT_JSON" '.subscribing | if type=="array" then length else 0 end')"
COMING_COUNT="$(extract_json "$CURRENT_JSON" '.coming | if type=="array" then length else 0 end')"
LISTED_COUNT="$(extract_json "$CURRENT_JSON" '.listed | if type=="array" then length else 0 end')"

log "probe /api/market/stats"
MARKET_JSON="$(http_get '/api/market/stats')"
MARKET_SUCCESS="$(extract_json "$MARKET_JSON" '.success // false')"

echo ""
echo "================= 一键自检结果 ================="
echo "BASE_URL: ${BASE_URL}"
echo "dashboard.success: ${DB_SUCCESS}"
echo "dashboard.top3: ${TOP3_COUNT}"
echo "dashboard.leaderboard: ${LEADERBOARD_COUNT}"
echo "score.success: ${SCORE_SUCCESS}"
echo "score.totalScore: ${SCORE_TOTAL}"
echo "score.rating: ${SCORE_RATING}"
echo "score.error: ${SCORE_ERROR}"
echo "ipo.top.count: ${TOP_COUNT}"
echo "ipo.current.subscribing: ${SUB_COUNT}"
echo "ipo.current.coming: ${COMING_COUNT}"
echo "ipo.current.listed: ${LISTED_COUNT}"
echo "market.success: ${MARKET_SUCCESS}"

if [[ "${DB_SUCCESS}" != "true" ]]; then
  echo "[FAIL] /api/dashboard failed"
  exit 3
fi
if [[ "${SCORE_SUCCESS}" != "true" ]]; then
  echo "[WARN] /api/score/${SCORE_CODE} failed: ${SCORE_ERROR}"
fi
if [[ "${TOP3_COUNT}" == "0" && "${LEADERBOARD_COUNT}" == "0" ]]; then
  echo "[WARN] dashboard empty; check ETNet access and data/ipo-list.json"
fi

echo "[PASS] 一键检查已完成"
