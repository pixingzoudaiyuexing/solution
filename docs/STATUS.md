# Solution Status

## Current Contract

```text
Solution A1: PASS / COMPLETE / CLOSED / RE-FROZEN
Reviewed A1 implementation anchor: 7331e68121d6a03aec83cb1d0cbc0ee23e1c9f52
Gemini final review: PASS (BLOCKER: 0, HIGH: 0)
A2: PASS / COMPLETE / CLOSED / RE-FROZEN
Reviewed A2 runtime/code anchor: f07770167a823e95665600c59e9e6e4f6d5d4927
Gemini A2 follow-up review: PASS (BLOCKER: 0, HIGH: 0)
Public routes: 52 (including REG-M03 implementation candidate)
Production: NOT DEPLOYED
Control Plane deployment secrets: NOT PROVISIONED
Live Admin Runtime: NOT VERIFIED
A2 Production KV namespace / binding: NOT PROVISIONED
A2 Production Cron: NOT ACTIVATED
A3: PASS / COMPLETE / CLOSED / RE-FROZEN
Reviewed A3 runtime/code anchor: fa5b7714c7ecd61b49a977729a7ec652fb8e61ab
Final independently reviewed A3 main anchor: 1729943b57e71ad9726b03f47b7882180e51ce91
Gemini A3 post-code review: PASS (BLOCKER: 0, HIGH: 0, MEDIUM: 0, LOW: 0)
A3 Production KV namespace / binding: NOT PROVISIONED
A3 Production Cron: NOT ACTIVATED
A4: NOT STARTED / NOT AUTHORIZED
REG-M03 Download Center: IMPLEMENTATION CANDIDATE / MANDATORY GEMINI REVIEW PENDING
REG-M03 Production deployment: NOT AUTHORIZED / NOT DEPLOYED
```

Reviewed/current repository baseline before this reconciliation: `472635dbedb8efb23cb070ad827db970ddabf56f`. The docs-only reconciliation commit after A2 closure does not modify or re-review the A2 runtime/code anchor.

## Custom Pages Runtime

- Runtime source: Reserved Knowledge Registry `custom-pages` A2 snapshot; V2Board remains unmodified.
- Route: authenticated `GET /api/v1/custom-pages`, preserving only `id/title/url/mode`.
- Request sequence: Bearer syntax gate -> Official V2Board `user/info` session validation -> Registry snapshot -> explicit DTO.
- Registry unavailable after valid session returns empty items; no Notice fallback/merge and no target fetch/probe.
- Ordinary Notice list/detail retain lowercase `aureole:*` reserved-row filtering; legacy Notice rows remain.

## Current Consumer Runtime

当前 Aureole 已使用：

```text
Reserved Knowledge Registry -> Solution /api/v1/custom-pages
```

Custom Pages Registry source migration 已 `PASS / COMPLETE / CLOSED / RE-FROZEN`，Gemini independent post-code review 为 `PASS / 0 BLOCKER / 0 HIGH / 0 MEDIUM / 0 LOW`。legacy Notice rows 未删除，Production cutover 未执行。

```text
Reserved Knowledge Registry -> Solution -> Aureole
```

普通 Notice route 保持现有实现和 reserved-row filtering；Custom Pages route 不定义 Registry + Notice merge或 runtime fallback。

## A1 Registry Kernel Closure

- Internal deployment bindings: `V2BOARD_CONTROL_AUTH_DATA`, `V2BOARD_CONTROL_ADMIN_PREFIX`.
- Control Plane source: Official V2Board Admin Knowledge list/detail, read-only and zero-patch.
- Reserved category: `__AUREOLE_REGISTRY__`; envelope kind: `aureole.registry`; supported core version: `1`.
- Validation kernel includes strict envelopes, module isolation, stable IDs/references/cycle detection, code-owned exposure, DTO allowlist projection and dual provider Secret Source primitives.
- No Public Registry route, generic Admin proxy, Admin mutation, data-plane Admin fetch, KV/snapshot/Cron/health scheduler or A2 implementation.
- A1 已完成并 re-frozen；Gemini final review 为 PASS，BLOCKER 与 HIGH 均为 0。
- Residual: `REG-KERNEL-003` 为 MEDIUM / NEEDS RUNTIME EVIDENCE；真实目标部署中 Admin Knowledge 的 `id/show` JSON serialization types 尚未 runtime verified。

## A2 Registry Operational Foundation Closure

- Exactly one logical code binding: `REGISTRY_KV`; no Production namespace ID or remote binding exists.
- Fixed keys: `registry:snapshot:v1`, `registry:health:v1`, `registry:alert:v1`; snapshot schema version is `1`.
- Safe per-module projection precedes persistence; Knowledge plaintext, resolved Solution secret, raw Admin response and raw Knowledge body are excluded from KV and fingerprints.
- Latest validation state is separate from LKG. Invalid/source failure preserves valid LKG; disabled or absent modules do not retain active config.
- `STALE_TOLERANT` and `FRESH_REQUIRED` are code-owned bounded policies evaluated from `validatedAt`; KV TTL is not a security boundary.
- Worker default fetch delegates to the existing Hono app. Internal scheduled execution calls Registry refresh without adding a Public route; route count remains `47`.
- Health/alert state is internal and redacted; no Telegram, webhook, live provider probe or product module is implemented.
- A2 is `PASS / COMPLETE / CLOSED / RE-FROZEN`. Gemini Follow-Up is `PASS` with `BLOCKER: 0` and `HIGH: 0`.
- Residual: `REG-KERNEL-003` remains `MEDIUM / NEEDS RUNTIME EVIDENCE`; real target Admin Knowledge `id/show` JSON serialization types remain runtime-unverified.
- Cloudflare KV eventual consistency is an accepted platform limitation. Snapshot, health and alert use separate KV writes and may temporarily show a cross-generation observability mismatch; this is an accepted LOW residual.
- Production remains `NOT DEPLOYED`: KV namespace/binding and Cron are not provisioned/activated, Control Plane deployment secrets are not provisioned, and live Admin Runtime is not verified.

## A3 Registry Runtime Settings Closure

- Only REG-M01 `runtime-settings` is registered; REG-M07 and all other product modules remain unimplemented.
- `runtime-settings` exposure is `public`, schema version is `1`, and code-owned freshness is `STALE_TOLERANT` with max stale age `86400` seconds.
- Strict config and snapshot schemas allow only `siteName`, `brandName`, `title`, `description`, `logoUrl`, `faviconUrl` and `footerText`; the Public DTO always returns all seven as `string | null`.
- `GET /api/v1/config/runtime` is anonymous, `no-store`, reads only the validated A2 `REGISTRY_KV` snapshot and performs zero Admin/Control Plane/refresh/V2Board/external fetches.
- Missing/corrupt/disabled/absent/stale/future-invalid state returns the all-null HTTP 200 fallback. A usable retained LKG is allowed only through the exact 24-hour boundary.
- Current Public route count is `48`; no generic Registry, raw, health, check or refresh route exists.
- A3 is `PASS / COMPLETE / CLOSED / RE-FROZEN`. Gemini post-code review is `PASS` with `BLOCKER/HIGH/MEDIUM/LOW: 0 / 0 / 0 / 0`.
- Production remains `NOT AUTHORIZED / NOT DEPLOYED`: Production KV namespace/binding and Cron are not provisioned/activated, Control Plane deployment secrets are not provisioned, and Live Admin Runtime is not verified. A4 remains `NOT STARTED / NOT AUTHORIZED`.

## REG-M02 Custom Pages Registry Source Migration Closure

- SOL-REG-M02-01 is `PASS / COMPLETE / CLOSED / RE-FROZEN`.
- Runtime/code anchor: `b01f7d1805ff35896968106899b92f29f86c91f7`; final independently reviewed feature/main anchor: `e5bbfc6e96c04609a6db565fcbe458392e5857b1`.
- Gemini post-code review: `PASS`; `BLOCKER/HIGH/MEDIUM/LOW: 0 / 0 / 0 / 0`.
- Only REG-M02 `custom-pages` is added; REG-M07 and all other product modules remain unimplemented.
- Module exposure is `authenticated`, schema version is `1`, and freshness is code-owned `STALE_TOLERANT` with max stale age `86400` seconds.
- Strict Registry items allow only stable `id`, `title.default`, `mode`, `url` and `enabled`; enabled items persist in Registry order as flattened `{id,title,url,mode}` snapshot data.
- `GET /api/v1/custom-pages` validates the real V2Board session through `user/info` before snapshot read. It does not impose subscription/purchase entitlement.
- No KV/missing/corrupt/disabled/absent/stale state returns authenticated `{items:[]}`; no Notice fallback or merge occurs. Public route count remains `48`.
- Custom Pages runtime authority is the Reserved Knowledge Registry `custom-pages` snapshot after real `user/info` session validation; there is no Notice fallback or Registry+Notice merge. Legacy Notice rows are NOT DELETED and Production cutover is NOT PERFORMED.
- Production remains `NOT AUTHORIZED / NOT DEPLOYED`; next Registry module is NOT AUTHORIZED.

## REG-M04/M06 Subscription Delivery Foundation Closure

- SOL-REG-M04-M06-01: `PASS / COMPLETE / CLOSED / RE-FROZEN`.
- Initial implementation anchor: `96bfcb37ffa02589ee2566399a0f19816ac999b6`.
- Security/final runtime fix anchor: `92a9a432b46707b011c3456018fc15d836277ab1`.
- Final independently reviewed/current-main anchor: `c884a73d93e240e2dddc7ea9f4e8ab58dffb736b`.
- Gemini: `PASS / 0 BLOCKER / 0 HIGH / 0 MEDIUM / 0 LOW`.
- `subscription-delivery` is authenticated, schema v1, code-owned `STALE_TOLERANT` with 86400-second bound; registered modules are runtime-settings, custom-pages and subscription-delivery only.
- New authenticated APIs are `GET /api/v1/subscription/delivery-options` and `POST /api/v1/subscription/access-link`; `/api/v1` route count is `50`.
- The current entitlement correction replaces previous-purchaser history with Official `user/info` fields matching `UserService::isAvailable()` before new credential issuance, while retaining exact Official `data.token` / subscribe_url equality. It is pending independent review and Primary acceptance; hidden-origin conflicts and unusable Registry state still fail closed without credential disclosure.
- Root `/{token}` and `/{prefix}/{token}` refresh is Registry-independent and streams through the fixed hidden origin/path. `info=hide` removes only `subscription-userinfo`; M05/YAML transformation is NOT IMPLEMENTED.
- Legacy CF-02 entries/entry-access, legacy access route, overview, rotate and advance remain unchanged. Aureole/V2Board/Production are unchanged.
- State: `PASS / COMPLETE / CLOSED / RE-FROZEN`; Production remains `NOT AUTHORIZED / NOT DEPLOYED`.
- M05 and REG-M07 remain `NOT IMPLEMENTED`; Aureole migration and CF-02 cleanup remain `NOT PERFORMED / NOT AUTHORIZED`; V2Board remains unchanged.

## REG-M03 Download Center Implementation Candidate

- Task state: implementation and local verification candidate only; mandatory Gemini post-code review remains required before merge/deployment.
- Registry module: `download-center`, public exposure, schema v1, maximum 50 items and 8 providers, fixed `release=latest`, strict `owner/repo`, bounded literal matcher, refresh `1..168` hours and max stale `refreshHours..168` hours.
- Provider model: module-level `github-url-prefix`; exactly two distinct enabled default provider IDs. Public DTO emits exactly two ordered `downloads[]` entries and no standalone original GitHub URL or obsolete `downloadUrl`/`mirrors` fields.
- Fixed provider boundary: `https://api.github.com/repos/{owner}/{repo}/releases/latest`, 10-second timeout, manual redirects, 512 KiB response bound, 100 assets, no Registry-selected URL and no GitHub token implementation.
- Derived key remains `registry:download-center:resolved:v1`; payload schema version is `2`, and old v1 payload fails closed. Normalized public provider-prefixed metadata plus effective config fingerprint and attempt/resolution/expiry timestamps only. Raw Registry/GitHub payload, provider base config, credentials and business/user data are excluded.
- Public API: anonymous `GET /api/v1/downloads`, HTTP 200 neutral collection, `Cache-Control: no-store`; unavailable items are omitted and missing/corrupt/expired state returns `items: []` without public cause leakage.
- Scheduled boundary remains one `waitUntil`, internally sequencing Registry refresh and M03 resolution. Per-run normalized repository Promise cache prevents duplicate GitHub calls; canonical seven items resolve three repositories. Browser data plane makes no Admin/GitHub/V2Board/provider request.
- Canonical public groups are Windows, Mac, Android and multiple Linux items for Aureole `Linux GUI` grouping. iOS is reserved for a future separately approved non-download destination and is not emitted in v1.
- `/api/v1` source route count is `52`; no new public health/registry/refresh/check/control-plane endpoint exists.
- V2Board, Aureole, Production, DNS and deployment configuration are unchanged. Production runtime remains NOT VERIFIED.
