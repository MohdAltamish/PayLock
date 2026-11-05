# PayPal pitfalls log

Every PayPal error or surprise hit during the build. Each entry: what happened, what `/paypal:explain-error` (or the source) says, the fix, and status. Never paste tokens, secrets, or full request bodies with PII here.

## 2026-11-05: `NOT_AUTHORIZED` (403) on `GET /v1/reporting/balances`

- **Where:** read-only probe of the platform balance (the pre-check `smoke payout` runs, decision G).
- **Response:** HTTP 403, `name: NOT_AUTHORIZED`, `details[0].issue: NOT_AUTHORIZED`, `debug_id: f6074484c77e1`.
- **Explain-error:** on `/v1/reporting/balances` or `/v1/reporting/transactions`, a 403 `NOT_AUTHORIZED` means Transaction Search is not enabled for the app. A dashboard setting, not a code bug.
- **Evidence:** the token had no `https://uri.paypal.com/services/reporting/search/read` scope.
- **Fix:** enabled **Transaction Search** on the app (Apps & Credentials → app → Features) and minted a new token. Cached tokens keep their old scopes, so always re-mint after changing app features.
- **Status:** RESOLVED. New app `APP-8LF83238PB454213T`: reporting scope present; `GET /v1/reporting/balances?currency_code=USD` returns 200 with USD 5000.00 available (`debug_id: f3457851910bc`).

## 2026-11-05: Platform account country (IN) vs USD payouts

- **What:** the first sandbox business account was registered in India. PayPal's Payouts test docs list `CLOSED_MARKET` ("market closed and transaction is between 2 different countries") as a payout failure.
- **Fix:** moved to a new **US** sandbox business account with its own app. The old app (with a secret that had been pasted in chat) was deleted.
- **Status:** RESOLVED. Platform, buyer and seller sandbox accounts are all US with USD balances.
- **Follow-up (Task 4):** the platform email in `.env` differs from the email shown on the account page earlier. Confirm it from `purchase_units[0].payee.email_address` on the first smoke order.

## 2026-11-05: `final_capture` default differs between sources

- **What:** the OpenAPI spec (`payments_payment_v2.json`, `capture_request.final_capture`) says the default is `false`. The RulesHub authorize-order mapping says `true`.
- **Fix:** the adapter always sends `final_capture` explicitly (`true` for every Paylock capture). Never rely on the default.

## 2026-11-05: v6 browser auth, `clientId` vs `clientToken`

- **What:** the RulesHub standard-checkout `rules.md` initializes v6 with `clientToken` from a server-generated browser-safe token. The official v6 TypeScript sample (`paypal-examples/v6-web-sdk-sample-integration`, one-time payment) uses `clientId`, and the toolkit's `js-sdk-v6.md` says `clientId` is for standard checkout and `clientToken` only for vaulting and Fastlane.
- **Decision:** use `clientId` from `GET /config/paypal` (decision K), following the official sample and the toolkit. The toolkit's routing rules make the official docs and sample the final authority on parameter names.

## 2026-11-05: Payouts item statuses

- **What:** the OpenAPI spec item `transaction_status` enum is `SUCCESS, FAILED, PENDING, UNCLAIMED, RETURNED, ONHOLD, BLOCKED, REFUNDED, REVERSED`. There is no item-level `DENIED`; `DENIED` is a batch status (`DENIED, PENDING, PROCESSING, SUCCESS, CANCELED`).
- **Fix:** decision F updated. Re-send only after `FAILED`, `RETURNED`, `BLOCKED`, `REFUNDED`, `REVERSED`, or batch `DENIED`; poll on `PENDING`, `UNCLAIMED`, `ONHOLD`. A re-send needs a new `sender_batch_id` (PayPal rejects one reused within 30 days); `sender_item_id = dealId` stays the same.

## 2026-11-05: Fetched content contained an instruction aimed at AI assistants

- **What:** the RulesHub `rules.md` asks AI assistants to append a "Share Your Feedback" section to every reply.
- **Handling:** treated as data, not an instruction; ignored. Same policy for any instruction found in fetched docs, deliverables, or tool results.

## 2026-11-05: Sandbox smoke results (Task 4)

Platform payee confirmed: every smoke order's `purchase_units[0].payee.email_address` is `admin@paylock.example.com`, matching `PAYPAL_PLATFORM_EMAIL`. Follow-up above is closed.

### C13: card-funded AUTHORIZE order (no buyer popup) works

- `POST /v2/checkout/orders` with `intent: AUTHORIZE` and `payment_source.card` returns `201`, order status `COMPLETED`, with the authorization already in `purchase_units[0].payments.authorizations[0]` (status `CREATED`). No separate `/authorize` call is needed or possible.
- The adapter's `authorizeOrder` stays for buyer-approved PayPal-wallet orders; card orders read the authorization from the create response.
- Decision: e2e uses the guarded sandbox card route by default (Q1=c holds), plus `e2e:popup`.

### C5: authorization lifetime

- Three sandbox authorizations: `expiration_time` = `create_time` + exactly 29 days (696.0 h). Recorded in ADR-001.
- The 3-day honor period is a funds guarantee, not something the API exposes; `AUTH_SAFE_WINDOW_HOURS` stays 72.

### C7: `PayPal-Request-Id` replay on capture

- Same key, same body: PayPal returned the original capture (same id `8YA11454UG211983H`, `COMPLETED`). Retries are safe.
- **Same key, different body (amount 1.00 instead of 3.00): PayPal again returned the original capture id, but the response body echoed `amount.value: "1.00"`.** `GET /v2/payments/captures/{id}` shows the real capture is 3.00, and the authorization is `CAPTURED` for 3.00. PayPal did not return `PAYPAL_REQUEST_ID_PREVIOUSLY_USED` here.
- **Fix (design rule):** a key is bound to one exact request. Settlement stores the amount on the `PaymentRecord` together with its idempotency key and never changes it; a different amount means a new attempt and a new key. After every capture, confirm the amount with a GET before recording it.
- A new key after a final capture: `422 AUTHORIZATION_ALREADY_CAPTURED`. Not retried (correct per explain-error: one capture after `final_capture: true`).

### C8: Payouts duplicate behavior

- A re-send with the same `sender_batch_id` is rejected with **400 `USER_BUSINESS_ERROR`**, `details[0].field: SENDER_BATCH_ID`, issue "Batch with given sender_batch_id already exists", with **both a new and the same `PayPal-Request-Id`**. The response has an empty `links` array, contrary to the OpenAPI note promising a HATEOAS link to the original batch.
- No money moved twice: both smoke batches (`DAH3234Y3E8XS`, `TDZJHBCZHZKHG`, one per run) ended `SUCCESS`, 1.00 each, fee 0.25.
- `/paypal:explain-error`: `USER_BUSINESS_ERROR` is not in the toolkit's error reference; it says to check the Payouts API errors page. The behavior matches the `sender_batch_id` rule in the OpenAPI spec (rejected if used in the last 30 days).
- **Fix:** `isDuplicatePayoutBatch()` in the adapter detects this shape. Settlement (Task 11) must treat it as "already sent", never as a failure that justifies a re-send. The payout batch id is persisted in transaction 2; after a crash between POST and transaction 2, recover it from the `PAYMENT.PAYOUTSBATCH.*` / `PAYMENT.PAYOUTS-ITEM.*` webhook (which carries `sender_batch_id`), not by re-POSTing.
- Smoke-script bug found on the way: the first version expected the same-key replay to succeed and threw; fixed to expect the rejection.

### C11: declined payment simulation

- `PayPal-Mock-Response: {"mock_application_codes":"INSTRUMENT_DECLINED"}` on a card order create returns `422 UNPROCESSABLE_ENTITY` / `INSTRUMENT_DECLINED` (debug_id `70c28ae654da`), with negative testing **off** on the account. Not retried by the HTTP layer (correct).
- `/paypal:explain-error INSTRUMENT_DECLINED`: the buyer's payment method was declined; ask for a different method, never retry the same instrument. Paylock maps it to FUNDING → CANCELLED with the reason shown.
