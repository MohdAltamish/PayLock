#!/usr/bin/env bash
# Phase 2 end-to-end check against the PayPal sandbox (BUILD_PLAN Task 11).
#
#   PASS path: create -> guard -> fund (sandbox card, server side) -> deliver -> RELEASED
#   FAIL path: create -> guard -> fund -> deliver a failing deliverable -> VOIDED
#
# Needs a running API started with AGENTS_MODE=stub (or replay) and E2E_FUNDING=card,
# seeded demo users (npm run seed), and jq. Amounts are small sandbox values.
#   API_URL=http://localhost:4100 scripts/curl-happy.sh
set -euo pipefail

API="${API_URL:-http://localhost:4000}"
TIMEOUT="${TIMEOUT_SECONDS:-120}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
j() { curl -sS --fail-with-body -H 'content-type: application/json' "$@"; }

users="$(j "$API/auth/demo-users")"
buyer="$(jq -r '.users[] | select(.role=="buyer") | .id' <<<"$users" | head -1)"
honest="$(jq -r '.users[] | select(.displayName=="Honest Seller") | .id' <<<"$users")"
rushed="$(jq -r '.users[] | select(.displayName=="Rushed Delivery Seller") | .id' <<<"$users")"
[[ -n "$buyer" && -n "$honest" && -n "$rushed" ]] || fail "demo users missing; run npm run seed"

login() { j -c "$work/$2" -X POST "$API/auth/demo-login" -d "{\"userId\":\"$1\"}" >/dev/null; }
login "$buyer" buyer.jar
login "$honest" honest.jar
login "$rushed" rushed.jar

run_path() {
  local name="$1" seller="$2" jar="$3" content="$4" want="$5" price="$6"
  echo "== $name path (expect $want)"
  local deal id state
  deal="$(j -b "$work/buyer.jar" -X POST "$API/deals" \
    -d "{\"sellerId\":\"$seller\",\"request\":\"Paylock curl check: one-page site for a bakery, budget \$$price\"}")"
  id="$(jq -r .id <<<"$deal")"
  echo "   deal $id $(jq -r .state <<<"$deal") amount $(jq -r .amount <<<"$deal")"

  state="$(j -b "$work/buyer.jar" -X POST "$API/deals/$id/guard" -d "{}" | jq -r .state)"
  echo "   guard -> $state"
  [[ "$state" == "GUARDED" ]] || fail "$name: expected GUARDED after guard, got $state"

  state="$(j -b "$work/buyer.jar" -X POST "$API/test/fund-with-card" -d "{\"dealId\":\"$id\"}" | jq -r .state)"
  echo "   fund (sandbox card) -> $state"
  [[ "$state" == "LOCKED" ]] || fail "$name: expected LOCKED after funding, got $state"

  state="$(j -b "$work/$jar" -X POST "$API/deals/$id/deliverables" \
    -d "{\"kind\":\"text\",\"content\":\"$content\"}" | jq -r .state)"
  echo "   deliver -> $state"

  local deadline=$((SECONDS + TIMEOUT)) view
  while :; do
    view="$(j -b "$work/buyer.jar" "$API/deals/$id")"
    state="$(jq -r .state <<<"$view")"
    case "$state" in RELEASED | RELEASED_PARTIAL | VOIDED | CANCELLED | SETTLEMENT_ERROR) break ;; esac
    ((SECONDS < deadline)) || fail "$name: still $state after ${TIMEOUT}s"
    sleep 2
  done
  echo "   final -> $state ($(jq -r '.blockReason // "-"' <<<"$view"))"
  jq -r '.payments[] | "   \(.kind) #\(.attempt) \(.status) paypal=\(.paypalStatus // "-") id=\(.paypalId // "-") amount=\(.amount // "-")"' <<<"$view"
  [[ "$state" == "$want" ]] || fail "$name: expected $want, got $state"
}

run_path "PASS" "$honest" honest.jar "Hosted site: https://example.com/bakery" RELEASED "${PASS_PRICE:-2.00}"
run_path "FAIL" "$rushed" rushed.jar "FAIL placeholder page with no content" VOIDED "${FAIL_PRICE:-1.50}"
echo "OK: PASS -> RELEASED and FAIL -> VOIDED against the sandbox"
