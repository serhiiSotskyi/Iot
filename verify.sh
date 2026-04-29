#!/usr/bin/env bash
#
# verify.sh — deployment verification suite.
#
# Asserts every documented auth boundary against a running stack. Reads
# DASHBOARD_PASSWORD, BRIDGE_API_TOKEN, ADMIN_API_TOKEN from .env (or the
# ambient environment) so no secrets are baked into this script.
#
# Usage:
#   ./verify.sh                          # defaults to http://localhost:3000
#   ./verify.sh http://localhost:3001
#
# Exit code is the number of failed assertions.

set -u

BASE_URL="${1:-http://localhost:3000}"
ENV_FILE="${ENV_FILE:-.env}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

: "${DASHBOARD_PASSWORD:?DASHBOARD_PASSWORD must be set in environment or .env}"
: "${BRIDGE_API_TOKEN:?BRIDGE_API_TOKEN must be set in environment or .env}"
: "${ADMIN_API_TOKEN:?ADMIN_API_TOKEN must be set in environment or .env}"

PASS=0
FAIL=0

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

assert_status() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    green "  PASS  $label  (got $actual)"
    PASS=$((PASS + 1))
  else
    red   "  FAIL  $label  (expected $expected, got $actual)"
    FAIL=$((FAIL + 1))
  fi
}

curl_status() {
  curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$@"
}

echo
yellow "Verifying $BASE_URL"
echo

# ---------- Dashboard auth gate ----------
echo "1. Dashboard auth gate"

actual=$(curl_status "$BASE_URL/")
# 307 redirect to /login when DASHBOARD_PASSWORD is set; 200 otherwise.
assert_status "GET /  →  307 redirect (cookie auth on)" "307" "$actual"

actual=$(curl_status "$BASE_URL/login")
assert_status "GET /login →  200" "200" "$actual"

# ---------- Login flow ----------
echo
echo "2. Login flow"

actual=$(curl_status -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"password":"definitely-not-the-real-password-zzz"}')
assert_status "POST /api/auth/login (wrong password) → 401" "401" "$actual"

cookie_jar=$(mktemp)
trap 'rm -f "$cookie_jar"' EXIT

actual=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  -c "$cookie_jar" \
  -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$DASHBOARD_PASSWORD\"}")
assert_status "POST /api/auth/login (correct password) → 200" "200" "$actual"

if grep -q iot_session "$cookie_jar"; then
  green "  PASS  Login set iot_session cookie"
  PASS=$((PASS + 1))
else
  red   "  FAIL  Login did not set iot_session cookie"
  FAIL=$((FAIL + 1))
fi

# ---------- Bridge ingest (BRIDGE_API_TOKEN) ----------
echo
echo "3. Bridge ingest auth (/api/movement)"

actual=$(curl_status -X POST "$BASE_URL/api/movement" \
  -H "Content-Type: application/json" \
  -d '{"event":"setup_status","voiceReady":true,"colourReady":true,"imuReady":true}')
assert_status "POST /api/movement no token → 401" "401" "$actual"

actual=$(curl_status -X POST "$BASE_URL/api/movement" \
  -H "Authorization: Bearer wrong-token" \
  -H "Content-Type: application/json" \
  -d '{"event":"setup_status","voiceReady":true,"colourReady":true,"imuReady":true}')
assert_status "POST /api/movement wrong token → 401" "401" "$actual"

actual=$(curl_status -X POST "$BASE_URL/api/movement" \
  -H "Authorization: Bearer $BRIDGE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event":"setup_status","voiceReady":true,"colourReady":true,"imuReady":true}')
assert_status "POST /api/movement with BRIDGE_API_TOKEN → 200" "200" "$actual"

# ---------- Bridge control (BRIDGE_API_TOKEN) ----------
echo
echo "4. Bridge control auth (/api/bridge/control)"

actual=$(curl_status "$BASE_URL/api/bridge/control")
assert_status "GET /api/bridge/control no token → 401" "401" "$actual"

actual=$(curl_status -H "Authorization: Bearer $BRIDGE_API_TOKEN" "$BASE_URL/api/bridge/control")
assert_status "GET /api/bridge/control with BRIDGE_API_TOKEN → 200" "200" "$actual"

# ---------- Stop endpoint (cookie OR ADMIN_API_TOKEN) ----------
echo
echo "5. Stop endpoint hybrid auth (/api/sessions/current/complete)"

actual=$(curl_status -X POST "$BASE_URL/api/sessions/current/complete")
assert_status "POST Stop no auth → 401" "401" "$actual"

actual=$(curl_status -X POST "$BASE_URL/api/sessions/current/complete" \
  -H "Authorization: Bearer wrong-admin-token")
assert_status "POST Stop wrong bearer → 401" "401" "$actual"

actual=$(curl_status -X POST "$BASE_URL/api/sessions/current/complete" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN")
assert_status "POST Stop with ADMIN_API_TOKEN → 200" "200" "$actual"

actual=$(curl_status -X POST "$BASE_URL/api/sessions/current/complete" -b "$cookie_jar")
assert_status "POST Stop with valid cookie → 200" "200" "$actual"

# ---------- Read-only endpoints (gated by cookie when auth on) ----------
echo
echo "6. Read-only endpoints"

actual=$(curl_status "$BASE_URL/api/latest")
assert_status "GET /api/latest no auth → 401 (when auth on)" "401" "$actual"

actual=$(curl_status -b "$cookie_jar" "$BASE_URL/api/latest")
assert_status "GET /api/latest with cookie → 200" "200" "$actual"

# ---------- Summary ----------
echo
total=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  green "All $total checks passed."
  exit 0
else
  red "$FAIL of $total checks failed."
  exit "$FAIL"
fi
