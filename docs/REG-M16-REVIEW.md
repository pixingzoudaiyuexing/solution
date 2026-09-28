# REG-M16 Navigation Registry Review Notes

Status: implementation and TEST evidence pending mandatory final independent review.

## Architecture

- Reserved V2Board Knowledge `registry:navigation` enters the existing strict Registry kernel, reference validation, operational projector, single `REGISTRY_KV` snapshot and 24-hour LKG path. No second data authority or Navigation-only key exists.
- The code-owned target allowlist has 12 semantic IDs and fixed default labels. All 12 must occur once; `dashboard` must be visible. Account is excluded from config and API; Aureole appends it last.
- Custom Pages are referenced only as `{moduleId:'custom-pages',itemId}` through `getReferences`. Missing IDs invalidate the new source; disabled modules/pages remain identities but do not render. The runtime resolver uses only current available Custom Pages and appends unreferenced enabled pages.
- The public API verifies `user/info` before reading Registry and emits only ordered core/custom-page identity and label. It never sends routes, URLs, visibility, source or freshness metadata.
- Invalid fresh Navigation keeps usable prior validated LKG. Missing/disabled/unavailable/stale Navigation uses compiled baseline; Custom Pages remain independently optional. Navigation never changes route existence or business authorization.

## Review Hotspots

1. Strict config and snapshot schemas: completeness, duplicate IDs, dashboard visibility, plain labels and 64-item bound.
2. Dependency validation through existing `RegistryReference`, especially disabled Custom Pages identity and removed items.
3. `readRegistryModuleSnapshot` LKG behavior, snapshot corruption and independent Custom Pages availability.
4. Public DTO isolation and real bearer validation before Registry reads.
5. TEST valid -> invalid -> restored Cron sequence; ensure prior LKG is returned during invalid source and TEST ends valid.

## TEST Plan

Use the official isolated TEST Admin Knowledge API, preserve existing records, and create only `registry:navigation`. Select an actual enabled Custom Page ID from current TEST config. Validate ordered/hidden/overridden outputs via authenticated `GET /api/v1/navigation`; then write one bounded invalid config, wait for real Cron, verify degraded Navigation health and unchanged public LKG, restore valid content, and wait for valid health. Do not delete shared KV or modify Custom Pages to fabricate a result. Record only redacted IDs/status/hashes.
