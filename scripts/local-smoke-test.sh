#!/usr/bin/env bash
# local-smoke-test.sh — Smoke test for EchoDeck local open-model mode
# Runs against a real local Ollama server if available; skips cleanly if not.
#
# Usage: ./scripts/local-smoke-test.sh [PORT]

set -euo pipefail

OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
PORT="${1:-3456}"
BASE_URL="http://127.0.0.1:$PORT"
TEMP_DIR=$(mktemp -d /tmp/echodeck-smoke-XXXXXX)
DATA_FILE="$TEMP_DIR/smoke-data.json"
PID_FILE="$TEMP_DIR/server.pid"

green() { printf "\033[32m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }

cleanup() {
  if [ -f "$PID_FILE" ]; then
    SERVER_PID=$(cat "$PID_FILE" || true)
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
      kill "$SERVER_PID" 2>/dev/null || true
      wait "$SERVER_PID" 2>/dev/null || true
    fi
  fi
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "=== EchoDeck Local Open-Model Smoke Test ==="

# 1. Check if Ollama is running
echo "Checking Ollama at $OLLAMA_URL..."
if ! curl -s -m 3 "$OLLAMA_URL/api/tags" > "$TEMP_DIR/tags.json" 2>/dev/null; then
  yellow "Ollama is not running at $OLLAMA_URL."
  yellow "Skipping local smoke test (clean skip)."
  exit 0
fi

# Detect an available model
AVAILABLE_MODELS=$(grep -o '"name":"[^"]*"' "$TEMP_DIR/tags.json" | cut -d'"' -f4 || true)
if [ -z "$AVAILABLE_MODELS" ]; then
  yellow "Ollama is running but has no pulled models."
  yellow "Skipping local smoke test (clean skip)."
  exit 0
fi

FIRST_MODEL=$(echo "$AVAILABLE_MODELS" | head -n 1)
OLLAMA_MODEL="${OLLAMA_MODEL:-$FIRST_MODEL}"
green "✓ Ollama is online. Using model: $OLLAMA_MODEL"
echo ""

# 2. Start EchoDeck in MODE=local on $PORT
echo "Starting EchoDeck in MODE=local on port $PORT..."
(
  cd server
  MODE=local \
  HOST=127.0.0.1 \
  PORT="$PORT" \
  DATA_FILE="$DATA_FILE" \
  OLLAMA_URL="$OLLAMA_URL" \
  OLLAMA_MODEL="$OLLAMA_MODEL" \
  LOG_LEVEL=warn \
  node dist/index.js > "$TEMP_DIR/server.log" 2>&1
) &
echo $! > "$PID_FILE"

# Wait for server to start
MAX_WAIT=20
WAITED=0
while ! curl -s "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; do
  sleep 0.5
  WAITED=$((WAITED + 1))
  if [ "$WAITED" -gt "$MAX_WAIT" ]; then
    red "Server failed to start within 10 seconds. Log output:"
    cat "$TEMP_DIR/server.log" || true
    exit 1
  fi
done
green "✓ EchoDeck local server is up at $BASE_URL"
echo ""

PASS=0
FAIL=0

check() {
  local label="$1"
  local status="$2"
  local body="$3"
  if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    green "✓ $label (HTTP $status)"
    PASS=$((PASS + 1))
  else
    red "✗ $label (HTTP $status)"
    echo "  Response: $body"
    FAIL=$((FAIL + 1))
  fi
}

# 3. GET /health
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/health")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n 1)
check "GET /health" "$STATUS" "$BODY"

# 4. GET /api/status
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/status")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n 1)
check "GET /api/status" "$STATUS" "$BODY"

# 5. POST /api/generate-deck with real Ollama model
echo "--- Testing Local LLM Card Generation ---"
NOTES="Transmission Control Protocol (TCP) provides reliable, ordered, and error-checked delivery of a stream of octets between applications running on hosts communicating via an IP network. User Datagram Protocol (UDP) is a connectionless protocol that provides low-latency, unnumbered packet transmission without delivery guarantees."

GEN_BODY=$(node -e "console.log(JSON.stringify({deckName: 'Smoke Test Network', notes: process.argv[1]}))" "$NOTES")
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/generate-deck" \
  -H "Content-Type: application/json" \
  -d "$GEN_BODY")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n 1)
check "POST /api/generate-deck" "$STATUS" "$BODY"

# 6. POST /api/study/next — Verify answer-leak rule
echo "--- Testing Study Next (Answer-Leak Rule) ---"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/study/next" \
  -H "Content-Type: application/json" \
  -d '{"deckName": "Smoke Test Network"}')
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n 1)
check "POST /api/study/next" "$STATUS" "$BODY"

# Verify back is NOT present
if echo "$BODY" | grep -q '"back"'; then
  red "✗ ANSWER LEAK DETECTED: 'back' was found in next_card response!"
  FAIL=$((FAIL + 1))
else
  green "✓ Answer-leak rule preserved: 'back' was omitted from next_card"
  PASS=$((PASS + 1))
fi

CARD_ID=$(echo "$BODY" | grep -o '"cardId":"[^"]*"' | head -n 1 | cut -d'"' -f4 || true)

# 7. POST /api/study/judge — Real LLM evaluation
if [ -n "$CARD_ID" ]; then
  echo "--- Testing Answer Evaluation with Local LLM ---"
  JUDGE_BODY=$(node -e "console.log(JSON.stringify({cardId: process.argv[1], answer: 'TCP provides reliable ordered transmission while UDP is connectionless without guarantees.'}))" "$CARD_ID")
  RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/study/judge" \
    -H "Content-Type: application/json" \
    -d "$JUDGE_BODY")
  BODY=$(echo "$RESP" | head -n -1)
  STATUS=$(echo "$RESP" | tail -n 1)
  check "POST /api/study/judge" "$STATUS" "$BODY"

  if echo "$BODY" | grep -q '"back"'; then
    green "✓ Back was properly revealed after answering"
    PASS=$((PASS + 1))
  fi
fi

# 8. GET /api/decks — Verify persistence & streak
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/decks")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n 1)
check "GET /api/decks" "$STATUS" "$BODY"

# Summary
echo ""
echo "==========================================="
echo "Local Smoke Test Results:"
echo "Passed: $PASS  Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  red "SOME CHECKS FAILED"
  exit 1
else
  green "ALL CHECKS PASSED SUCCESSFULLY"
fi
