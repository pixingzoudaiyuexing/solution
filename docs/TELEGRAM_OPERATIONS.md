# M17 Telegram Registry Operations

Scope: isolated TEST (`cc-solution-stg`); HIGH risk; formal independent review
is required and remains a Product Manager gate. Production is not authorized.

## Contract

`POST /internal/telegram/webhook` handles its own methods before public CORS.
Other methods return 405. A missing/incorrect secret returns an empty 403 before
the body or operational KV is read. Authenticated requests require JSON, at most
16 KiB, with a ten-second body-read limit. Unsupported updates are acknowledged
without processing. Only text from the exact numeric Owner ID in the same
private chat is eligible. Bot senders are excluded.

Only the exact bare strings `/health` and `/check` are supported. Arguments,
whitespace variants, bot mentions and unknown commands receive Chinese help.
No configuration editing, remote commands, deploy/restart or log retrieval exists.

`/health` reads existing health only and performs no KV writes or refresh.
`/check` uses `refreshRegistryOperationalState`, then reports that check's health.
Existing control-plane GET reads and derived snapshot/health/alert writes remain
the only Registry path. No Knowledge/config source is edited. Failed persistence
is reported as an incomplete check rather than a successful refresh.

## Secrets and transport

Required deployment secrets (values must never be put in files, reports or KV):

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (32–256 allowed ASCII characters; generate securely)
- `TELEGRAM_OWNER_USER_ID` (positive decimal safe integer; no leading zero)

Provision values only from the original Primary TEST handoff through a secure
deployment-secret pipeline. Never infer identity from examples or Git history.
Without all three valid bindings the endpoint is closed and alerts are disabled;
normal Registry and Download Center refresh continue.

Telegram sends use only the fixed official HTTPS API host, POST JSON, manual
redirect handling, no parse mode, disabled link previews, a 16 KiB response bound
and a five-second delivery deadline. Only HTTP success plus `ok: true`, a numeric
message confirmation and the configured private chat count as successful delivery.
Provider errors, response bodies, request URLs, update bodies and credentials are
not logged. Outgoing text is built solely from a fixed Chinese vocabulary and
validated health status/code/time fields; unknown module IDs are never echoed.

## Observations and delivery

The existing `registry:alert:v1` remains the sole derived alert record. Its optional
`delivery` extension contains no Owner/chat IDs, credentials, raw messages or
Knowledge. Legacy records still load. Snapshot and health schemas are unchanged.
An observed-only legacy recovery flag is cleared on healthy refresh unless a
confirmed delivered incident remains active; no recovery delivery is invented.

- A normalized fault fingerprint must be observed three times at increasing
  check timestamps. A changed issue resets that streak; module order does not.
- Confirmed fault sends set `lastAlertAt`, the active incident and a cooldown entry.
  Each issue has a 60-minute cooldown. Up to 16 unexpired issue entries are kept;
  if full, additional notifications wait for expiry rather than evicting cooldowns.
- Recovery is pending only after a delivered incident becomes healthy/disabled.
  One confirmed recovery clears the active incident and pending flag. Failed
  recovery retains both and is retried on a later normal check.
- Failed sends record an attempt outcome only, never successful delivery time.
  An observed but undelivered fault produces no misleading recovery notice.
- Delivery processing runs after health persistence and is folded into the existing
  single alert write per refresh, avoiding a second immediate write to that key.
  Telegram failure cannot fail Registry refresh. Download Center is run in `finally`.

## Concurrency, retries and limits

Cron and manual checks are serialized per KV binding within one Worker isolate.
Cron may reuse a completed local operation within one second. Every new, authorized
manual check refreshes even just after Cron; it waits only for the remainder of the
one-second same-key KV write interval while holding the isolate-local operation lock.
Cron timestamps do not throttle or suppress distinct manual checks.
An authenticated `/check` persists a completed update hash, numeric update sequence
(not an Owner identity) and check time inside the same derived alert record. A
duplicate/older update within seven days reads health without rerunning refresh;
the expiry permits Telegram's randomized sequence after a week without updates.
An isolate-local cache holds at most 128 hashed update results for up to 24 hours,
joining concurrent identical updates and suppressing already successful replies.
A failed reply returns 503 and can retry; a persisted completed check is reused.

**KV is eventually consistent and has no CAS or transaction spanning these keys.**
Isolate serialization, read-after-write visibility, cooldowns and update markers are
not globally linearizable. Concurrent isolates, a lost provider acknowledgement,
or failure to persist an acknowledged send can still produce duplicate delivery
or repeated checks. No global exactly-once guarantee is claimed. Existing health
and snapshot writes also retain their documented cross-key observation limitation.
This task adds no DO/D1, distributed lock, business store or second health authority.
Rolling back to pre-M17 code may discard extended derived alert metadata; the next
normal refresh rebuilds observations but cannot reconstruct delivery history.

## TEST acceptance and stop point

Use official `getMe`, `setWebhook` with the generated `secret_token` and
`allowed_updates: ["message"]`, then `getWebhookInfo`. Do not use `getUpdates`
polling or Telegram browser UI. Real Owner `/health`, `/check` and actual reply
delivery are separate acceptance evidence from local mocked-provider tests.
Do not forge Owner commands or corrupt live Registry data to provoke alerts.

If the Owner has not started the confirmed TEST bot, the sole required Owner
action is: 请打开 TEST bot，点击 Start，然后发送 /health。

The implementation dispatch does not itself contain the original Primary handoff
or real TEST bot/Owner credentials. Missing credentials block Telegram integration,
not local validation. Return exact implementation commit, TEST deployment evidence,
the missing acceptance items and formal-review status to Product Manager; do not
promote local tests to real Telegram acceptance or begin Production/M13.
