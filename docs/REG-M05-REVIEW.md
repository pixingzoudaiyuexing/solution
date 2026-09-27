# REG-M05 CC Clash Profile: Pre-Review Evidence

Status: M05 executable anchor `16dd4a3a8fecc3fb348272f71cecfd81a08597b2` passed its prior Formal Independent Review. Earlier isolated TEST integration and separate local real-node acceptance provide pre-D1 runtime evidence. The D1 group-layout delta requires a new bounded Formal Independent Review before any D1 TEST deployment.

## Scope and entry points

- Base main: `e1dfedad612236248093171fccd809a2b1d3460a`.
- Findings-fix review base: `379a2396b304daf7ea7726838a33ff595dcb04a6`.
- Public bearer routes: `GET /{token}` and `GET /{prefix}/{token}`. Only `profile=cc` enters the new transformer; absent/default retains the existing D-005 response body stream, headers and URL behavior.
- Authenticated routes: `GET /api/v1/subscription/delivery-options` adds `profiles`; `POST /api/v1/subscription/access-link` accepts `profileId=cc` and returns the complete bearer URL.
- New Registry module: `subscription-profile`, v1, authenticated, `STALE_TOLERANT` 86400 seconds. Config has literal `profileId=cc`, profile enabled/label and exactly seven ordered logical groups with enabled/label/defaultPolicy. Every group ID is from the code-known application catalog. No URL, YAML, script, regex or group graph is configurable.

Canonical v1 config inside the normal Registry envelope:

```json
{
  "profileId": "cc",
  "enabled": true,
  "label": { "default": "Clash 分流规则" },
  "groups": [
    { "id": "youtube", "enabled": true, "label": { "default": "YouTube" }, "defaultPolicy": "auto" },
    { "id": "google", "enabled": true, "label": { "default": "Google" }, "defaultPolicy": "auto" },
    { "id": "ai", "enabled": true, "label": { "default": "AI" }, "defaultPolicy": "auto" },
    { "id": "netflix", "enabled": true, "label": { "default": "Netflix" }, "defaultPolicy": "auto" },
    { "id": "disney", "enabled": true, "label": { "default": "Disney" }, "defaultPolicy": "auto" },
    { "id": "tiktok", "enabled": true, "label": { "default": "TikTok" }, "defaultPolicy": "auto" },
    { "id": "bilibili", "enabled": true, "label": { "default": "Bilibili" }, "defaultPolicy": "direct" }
  ]
}
```

## Fixed rule source catalog

The Worker only emits HTTPS provider definitions. It never fetches these datasets during subscription requests. The client fetches them later.

| Logical ID | Exact URL | Behavior |
| --- | --- | --- |
| youtube | `https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/youtube.mrs` | domain |
| google | `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google.mrs` | domain |
| ai | `https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/ai.mrs` | domain |
| netflix | `https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/netflix.mrs` | domain |
| disney | `https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/disney.mrs` | domain |
| tiktok | `https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/tiktok.mrs` | domain |
| bilibili | `https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/bilibili.mrs` | domain |
| ads | `https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/ads.mrs` | domain |
| private | `https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/private.mrs` | domain |
| privateip | `https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/privateip.mrs` | ipcidr |
| cn | `https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/cn.mrs` | domain |
| cnip | `https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/cnip.mrs` | ipcidr |
| proxy | `https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset/proxy.mrs` | domain |

DustinWin documents `google-cn` as China-oriented Google rules; it is not used for the general Google group. DustinWin provider URLs use its `mihomo-ruleset` release tag; MetaCubeX Google uses the verified `meta` branch raw MRS asset. No source ID or URL is present in the public profile marker or neutral delivery DTO.

## Security and policy checks

- V2Board remains token, entitlement and node authority. The enhanced request appends fixed internal `flag=meta` to the fixed configured subscribe path. V2Board controller source confirms query `flag` takes priority over User-Agent. Redirects remain manual through the existing origin client.
- Pre-read `Content-Length` and actual stream bytes are limited to 5 MiB; body read has a 10-second timeout. The YAML parser disables its quadratic built-in unique-key check. A bounded AST traversal uses per-map `Set` checks before `toJS`, limiting each map to 4096 entries, total nodes to 100000, depth to 64 and scalar length to 1 MiB while rejecting duplicate keys, anchors, aliases, tags and prototype/merge keys. Output has a 10 MiB ceiling.
- Upstream proxy objects and credentials are preserved in memory and output, never written to Registry/KV or logs. Only the V2Board-emitted remote protocol types `ss`, `vmess`, `vless`, `trojan`, `tuic`, `anytls`, `hysteria` and `hysteria2` count as usable routing nodes; known direct/reject/pass/DNS local outbounds never enter generated policies. Unknown types fail closed.
- Safe top-level settings (including independent DNS and loopback controller) and validated existing group semantics survive. DNS strings, nested keys and arrays containing provider references in either `rule-set:old-cn` or `RULE-SET,old-cn,real-ip` form are rejected before upstream provider definitions are replaced; ordinary independent DNS remains. Existing group health URLs are normalized to a fixed HTTPS probe; provider wiring, regex filters and unsupported behavior fields are rejected. Validated `default-selected`, `disable-udp`, health timing/status, load-balance strategy and other code-known local options are retained. `expected-status` accepts only a validated string scalar such as `"204"`, `"200/302"` or `"400-503"`; arrays, objects, booleans, null and unquoted numeric scalars fail closed.
- Group names, dependencies, cycles and managed collisions are checked. Reachability uses memoization over the validated DAG, so shared subgraphs are evaluated once. Safe exact-name automatic/fallback groups may be reused; otherwise minimal code-owned groups use real remote nodes. Collision checks cover every preserved proxy name, including local/special outbounds, plus upstream group names. Routing members remain restricted to remote proxy names. In D1 the helpers are hidden when a safe primary selector exists; incompatible type or node reachability still fails closed. Their prior visible layout remains the no-primary fallback.
- Rule order: private domain/IP DIRECT, ads REJECT, enabled application groups in configured order, CN domain/IP DIRECT, proxy domain automatic, then MATCH automatic. Bilibili's canonical config default is DIRECT; other application groups default to automatic. Every visible application group also lists fallback and individual nodes.
- After syntactically valid `profile=cc` parsing, every operational failure returns HTTP 404, `subscription_unavailable`, `Cache-Control: no-store` and `Content-Type: text/plain; charset=utf-8`. Syntax errors remain 400. Default profile error status compatibility is unchanged. Authenticated link/options errors use existing neutral categories. Raw token URLs, YAML and credentials are not logged. Cloudflare query redaction and disabled invocation logs are unchanged.

## REG-M05-D1 Dynamic Primary Group Layout (pending new Formal Independent Review)

The old M05 layout displayed `自动选择` and `故障转移` as independent first-level groups. D1 changes only the CC group graph. The first upstream-order, visible `select` group that can reach a real remote proxy and cannot be reached from either helper becomes the dynamic primary selector. It is selected by validated structure, never by an airport name, label keyword or new Registry field. The helper dependency check is linear over the bounded, cycle-checked group graph; a candidate that would form a new cycle is skipped.

When a primary exists, its first two choices are `自动选择` and `故障转移`, followed by all original choices in original relative order, with duplicate helper references removed. The helpers are `hidden: true` and appear after all visible groups in the YAML array. The visible order is primary, the seven configured application groups, then other retained upstream groups in original relative order. Existing exact-name helpers must still pass type, remote-only reachability and safe-field validation before reuse. When no safe primary exists, D1 keeps the former visible auto/fallback-first layout and creates no guessed primary name.

Application group defaults and choices, private/ads/CN/foreign/MATCH rules, proxy objects, credentials, DNS and default D-005 streaming remain unchanged. `foreign` and `MATCH` still target `自动选择`, never the upstream primary selector.

Local client evidence uses synthetic credentials only: `Mihomo Meta v1.19.25` accepted the transformed YAML with `-t`; the real Unix API reported both helpers hidden and as the primary's first two choices. Both primary and YouTube could select either hidden helper and a concrete node, with 204 and matching GET readback. For the installed Clash Verge v2.5.1, its rule-mode renderer filters `group.hidden`, and its proxy data logic derives group order from Mihomo `GLOBAL.all`; applying that exact data flow to the live synthetic API response produced primary then YouTube, Google, AI, Netflix, Disney, TikTok, Bilibili. The user's existing Clash Verge profile was not modified or screenshot-tested. No credential-bearing subscription was used for this D1 client check.

## Findings-to-fix map

| Finding | Fix | Regression evidence |
| --- | --- | --- |
| F-01 HIGH | Memoized only-remote-node reachability over the cycle-checked group DAG | Chain, repeated-child and shared-predecessor DAGs up to 120 groups; cycle rejection |
| F-02 HIGH | `uniqueKeys: false` plus linear AST `Set` duplicate check and 4096-entry/map cap | 4096-key acceptance, 4097/20000-key rejection, late duplicate, node/depth/scalar and unsafe YAML cases |
| F-03 MEDIUM | Code-owned remote protocol allowlist; special outbound exclusion | Direct-only rejection; mixed special/remote node selection |
| F-04 MEDIUM | Recursive DNS provider dependency rejection recognizes colon and comma rule syntax, case and nested keys/values/arrays | Independent DNS preserved; `rule-set:old-cn` and `RULE-SET,old-cn,real-ip` variants rejected |
| F-05 MEDIUM | `expected-status` validates the raw string scalar and emits that same scalar | Valid string status/range preserved; sequence/object/boolean/null/number/invalid syntax rejected; other group options preserved |
| F-06 MEDIUM | Collision namespace includes all preserved proxy names, while managed routing keeps the remote-only set | Special outbound collisions with both base groups, all application labels and a custom label rejected; ordinary special outbound preserved but excluded from routing |
| F-07 MEDIUM | One CC operational 404 response signature | Missing/disabled Registry, upstream 4xx/5xx, timeout, invalid/oversized YAML and transform error equivalence |

## Review hotspots

1. Confirm default bundle initialization and response-body stream identity are unchanged for absent/default profile.
2. Verify YAML parser and Worker CPU/memory limits against adversarial but sub-5 MiB inputs. AST resource checks occur after parsing; the 5 MiB pre-parse byte cap remains the first hard bound.
3. Verify real V2Board ClashMeta output passes the top-level and group safety boundary in isolated TEST only after formal review.
4. Verify Mihomo consumes each approved MRS provider and rule syntax during later isolated TEST acceptance.
5. Confirm Registry snapshot invalidation and disabled/stale behavior cannot mint CC access links or expose raw config.

No Aureole, V2Board, Production, DNS or CF-02 changes are included. Formal Independent Review cannot be substituted by the internal agy review.
