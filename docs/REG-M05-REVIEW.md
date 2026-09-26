# REG-M05 CC Clash Profile: Pre-Review Evidence

Status: Solution implementation only. Formal Independent Review is required before isolated TEST deployment. No runtime acceptance is claimed here.

## Scope and entry points

- Base main: `e1dfedad612236248093171fccd809a2b1d3460a`.
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
- Pre-read `Content-Length` and actual stream bytes are limited to 5 MiB; body read has a 10-second timeout. YAML parsing rejects anchors, aliases, tags, duplicate mapping keys, prototype keys, excessive nodes/depth/scalars and unsupported top-level constructs. Output is deterministically serialized with a 10 MiB ceiling.
- Upstream proxy objects and credentials are preserved in memory and output, never written to Registry/KV or logs. Safe top-level settings (including DNS and loopback controller) and valid existing group membership survive. Upstream rules and rule-provider definitions are replaced. Existing group URLs/provider wiring are removed; health probes use a fixed HTTPS URL.
- Group names, dependencies, cycles, managed collisions and node reachability are checked. The selected automatic/fallback groups must resolve only to real proxies; otherwise minimal code-owned groups are created.
- Rule order: private domain/IP DIRECT, ads REJECT, enabled application groups in configured order, CN domain/IP DIRECT, proxy domain automatic, then MATCH automatic. Bilibili's canonical config default is DIRECT; other application groups default to automatic. Every visible application group also lists fallback and individual nodes.
- Public failures return only `subscription_unavailable`; authenticated link/options errors use existing neutral categories. Raw token URLs, YAML and credentials are not logged. Cloudflare query redaction and disabled invocation logs are unchanged.

## Review hotspots

1. Confirm default bundle initialization and response-body stream identity are unchanged for absent/default profile.
2. Verify YAML parser and Worker CPU/memory limits against adversarial but sub-5 MiB inputs.
3. Verify real V2Board ClashMeta output passes the top-level and group safety boundary in isolated TEST only after formal review.
4. Verify Mihomo consumes each approved MRS provider and rule syntax during later isolated TEST acceptance.
5. Confirm Registry snapshot invalidation and disabled/stale behavior cannot mint CC access links or expose raw config.

No Aureole, V2Board, Production, DNS or CF-02 changes are included. Formal Independent Review cannot be substituted by the internal agy review.
