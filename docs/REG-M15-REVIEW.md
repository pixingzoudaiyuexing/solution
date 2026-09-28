# REG-M15 Help Center Review Notes

Status: implementation evidence; mandatory independent review and isolated TEST acceptance remain separate gates.

## Architecture and Trust Boundaries

- User Knowledge list/search supplies authenticated visible metadata and V2Board's title/body keyword semantics. `REGISTRY_CATEGORY` is filtered before counting or returning anything.
- Article detail verifies the requested decimal ID against that User catalog, then reads raw detail with the existing `V2BoardControlPlaneClient`. The raw metadata must match the User metadata and be visible. The User detail endpoint is excluded because it expands subscription URL placeholders.
- The Control Plane retains its existing secret/bootstrap and Cloudflare Access path. No admin auth material, origin, raw body, Registry envelope or subscription credential is part of the Help DTO.
- The parser removes complete access ranges before parse5, enforces byte/tree/output limits, discards dangerous tags, rejects foreign SVG/Math markup, and emits only typed neutral nodes. It never emits HTML for browser insertion. URL fields are validated absolute HTTPS destinations, without a server-side fetch.
- Download references only select an ID and primary/backup slot from the existing M03 resolved cache. Unknown/unavailable references disappear independently; articles do not own provider URLs, labels, release discovery or mirrors.

## M03 Additive Delta

`harmonyos` was added to the public DownloadPlatform, Registry config schema and resolved snapshot schema. The canonical `clashbox-harmonyos` Knowledge item uses `xiaobaigroup/ClashBox`, `latest`, suffix `.hap`, contains `ClashBox`, and exactly one matching asset. Existing item IDs, provider definitions/order and M03 resolver behavior are unchanged. Production Knowledge is outside this implementation.

## Review Hotspots

1. Confirm User Knowledge's TEST list shape, search behavior and bearer failure status. A malformed/failed upstream response returns a neutral error; no privileged read follows an unverified visible catalog.
2. Verify raw Knowledge detail is unexpanded and metadata cross-checks reject hidden, changed or reserved records.
3. Inspect parse5 tree repair, access marker scanner, URL policy, placeholder literals, and resource bounds. In particular, malformed SVG/Math markup is rejected to avoid relocated child text.
4. Check M03 resolved-state staleness and the two ordered destination slots. No TEST result should be inferred from a synthetic KV fixture.
5. Confirm TEST Registry Knowledge edit preserves the prior item list/providers and actual Cron generates the new resolved item. Keep TEST fixture cleanup evidence separate from code validation.

## Validation Record

At the implementation stage, focused Help/ClashBox tests passed (88 tests), the full suite passed (73 files, 2027 tests), `npm run typecheck` passed, `npm run build` passed the Worker dry-run, and `git diff --check` passed. This repository has no lint script. Isolated TEST deployment and runtime readback are separate pending evidence. No Production action is authorized by this document.

TEST readback after the first deployment confirmed a V2Board shape exception: no-hit User Knowledge search serializes its empty grouped collection as `data: []`. The first Worker version returned neutral 503; the follow-up fix accepts only this exact empty-array shape as an empty catalog. Nonempty arrays remain invalid. This requires a separate fix commit, redeployment and runtime readback.

After the fix, the complete local suite passed (73 files, 2028 tests), typecheck and Worker dry-run build passed, and `git diff --check` passed. Existing TEST ordinary categories, browse and detail returned 200; invalid bearer returned 401 and a reserved direct ID returned neutral 404. The no-hit search still requires redeployed Worker readback.
