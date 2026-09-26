# REG-M05 CC Clash Profile: Pre-Review Evidence

Status: Original `379a2396b304daf7ea7726838a33ff595dcb04a6` Formal Independent Review failed with F-01 through F-07. This findings fix requires bounded independent re-review before isolated TEST deployment. No runtime acceptance is claimed here.

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
- Safe top-level settings (including independent DNS and loopback controller) and validated existing group semantics survive. DNS containing `rule-set:` dependencies is rejected before upstream provider definitions are replaced. Existing group health URLs are normalized to a fixed HTTPS probe; provider wiring, regex filters and unsupported behavior fields are rejected. Validated `default-selected`, `disable-udp`, health timing/status, load-balance strategy and other code-known local options are retained.
- Group names, dependencies, cycles and managed collisions are checked. Reachability uses memoization over the validated DAG, so shared subgraphs are evaluated once. The visible entry groups are always exactly `自动选择` and `故障转移`: safe exact-name groups may be reused; otherwise minimal code-owned groups use real remote nodes. An exact-name group with incompatible type, hidden state or node reachability fails closed. Opaque upstream groups remain available but do not replace the two product entry names.
- Rule order: private domain/IP DIRECT, ads REJECT, enabled application groups in configured order, CN domain/IP DIRECT, proxy domain automatic, then MATCH automatic. Bilibili's canonical config default is DIRECT; other application groups default to automatic. Every visible application group also lists fallback and individual nodes.
- After syntactically valid `profile=cc` parsing, every operational failure returns HTTP 404, `subscription_unavailable`, `Cache-Control: no-store` and `Content-Type: text/plain; charset=utf-8`. Syntax errors remain 400. Default profile error status compatibility is unchanged. Authenticated link/options errors use existing neutral categories. Raw token URLs, YAML and credentials are not logged. Cloudflare query redaction and disabled invocation logs are unchanged.

## Findings-to-fix map

| Finding | Fix | Regression evidence |
| --- | --- | --- |
| F-01 HIGH | Memoized only-remote-node reachability over the cycle-checked group DAG | Chain, repeated-child and shared-predecessor DAGs up to 120 groups; cycle rejection |
| F-02 HIGH | `uniqueKeys: false` plus linear AST `Set` duplicate check and 4096-entry/map cap | 4096-key acceptance, 4097/20000-key rejection, late duplicate, node/depth/scalar and unsafe YAML cases |
| F-03 MEDIUM | Code-owned remote protocol allowlist; special outbound exclusion | Direct-only rejection; mixed special/remote node selection |
| F-04 MEDIUM | Recursive DNS provider dependency rejection before provider replacement | Independent DNS preserved; `rule-set:old-cn` rejected |
| F-05 MEDIUM | Explicit validation/preservation of safe group fields, fixed health URL | Selection/UDP/load-balance/health options preserved; unsupported/provider fields rejected |
| F-06 MEDIUM | Stable managed auto/fallback names with exact-name safe reuse | Opaque names, exact-name reuse and incompatible-name collision cases |
| F-07 MEDIUM | One CC operational 404 response signature | Missing/disabled Registry, upstream 4xx/5xx, timeout, invalid/oversized YAML and transform error equivalence |

## Review hotspots

1. Confirm default bundle initialization and response-body stream identity are unchanged for absent/default profile.
2. Verify YAML parser and Worker CPU/memory limits against adversarial but sub-5 MiB inputs. AST resource checks occur after parsing; the 5 MiB pre-parse byte cap remains the first hard bound.
3. Verify real V2Board ClashMeta output passes the top-level and group safety boundary in isolated TEST only after formal review.
4. Verify Mihomo consumes each approved MRS provider and rule syntax during later isolated TEST acceptance.
5. Confirm Registry snapshot invalidation and disabled/stale behavior cannot mint CC access links or expose raw config.

No Aureole, V2Board, Production, DNS or CF-02 changes are included. Formal Independent Review cannot be substituted by the internal agy review.
