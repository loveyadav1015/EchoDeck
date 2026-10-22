#!/usr/bin/env bash
# smoke-test.sh — quick sanity check for the EchoDeck MCP server
# Usage: ./scripts/smoke-test.sh [BASE_URL]
#   Default BASE_URL: http://localhost:3000

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
PASS=0
FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }

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

# TODO(VERIFY): the required headers for Streamable HTTP. The MCP spec (2025-11-25) may
# require Accept to include both application/json and text/event-stream, or just
# application/json for non-streaming responses. Verify against the spec.
MCP_HEADERS=(
  -H "Content-Type: application/json"
  -H "Accept: application/json, text/event-stream"
)

echo "=== EchoDeck Smoke Test ==="
echo "Target: $BASE_URL"
echo ""

# 1. Health check
echo "--- Health Check ---"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/health")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n 1)
check "GET /health" "$STATUS" "$BODY"
echo ""

# 2. MCP initialize
echo "--- MCP Initialize ---"
INIT_BODY='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0.0"}}}'
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/mcp" "${MCP_HEADERS[@]}" -d "$INIT_BODY")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n 1)
check "POST /mcp initialize" "$STATUS" "$BODY"
echo ""

# 3. tools/list
echo "--- Tools List ---"
TOOLS_BODY='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/mcp" "${MCP_HEADERS[@]}" -d "$TOOLS_BODY")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n 1)
check "POST /mcp tools/list" "$STATUS" "$BODY"
echo ""

# 4. tools/call — create_deck
echo "--- Tool: create_deck ---"
CREATE_BODY='{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_deck","arguments":{"deckName":"Smoke Test","cards":[{"front":"What is a smoke test?","back":"A quick check that the basic functionality works."}]}}}'
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/mcp" "${MCP_HEADERS[@]}" -d "$CREATE_BODY")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n 1)
check "POST /mcp tools/call create_deck" "$STATUS" "$BODY"
echo ""

# 5. tools/call — next_card
echo "--- Tool: next_card ---"
NEXT_BODY='{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"next_card","arguments":{"deckName":"Smoke Test"}}}'
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/mcp" "${MCP_HEADERS[@]}" -d "$NEXT_BODY")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n 1)
check "POST /mcp tools/call next_card" "$STATUS" "$BODY"
echo ""

# 6. tools/call — grade_answer (use a dummy card id; will get not_found but that is a valid response)
echo "--- Tool: grade_answer ---"
GRADE_BODY='{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"grade_answer","arguments":{"cardId":"smoke-test-fake-id","rating":"good"}}}'
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/mcp" "${MCP_HEADERS[@]}" -d "$GRADE_BODY")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n 1)
check "POST /mcp tools/call grade_answer" "$STATUS" "$BODY"
echo ""

# 7. tools/call — get_progress
echo "--- Tool: get_progress ---"
PROGRESS_BODY='{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_progress","arguments":{}}}'
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/mcp" "${MCP_HEADERS[@]}" -d "$PROGRESS_BODY")
BODY=$(echo "$RESP" | head -n -1)
STATUS=$(echo "$RESP" | tail -n 1)
check "POST /mcp tools/call get_progress" "$STATUS" "$BODY"
echo ""

# Summary
echo "==========================="
echo "Passed: $PASS  Failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  red "SOME CHECKS FAILED"
  exit 1
else
  green "ALL CHECKS PASSED"
fi
