# Architecture Decisions

| ID    | 状态      | 决策内容 |
|-------|---------|--------------------------------------------------------------------------------|
| D-001 | APPROVED | 单 Cloudflare Worker，Gateway + Adapter 仅做模块分层，不拆服务。 |
| D-002 | APPROVED | Public API 采用稳定 `/api/v1` resource contract，禁止 transparent proxy。 |
| D-003 | APPROVED | V2Board `auth_data` 作为 opaque credential，公网使用 Bearer 表达，Gateway 不创建第二套 Session。 |
| D-004 | APPROVED | Browser checkout 经过 solution；Payment Provider callback 直接进入 V2Board。solution 不代理、重写或持有 callback，也不持有支付状态。 |
| D-005 | APPROVED | Access/subscription body 不转换协议，由 Worker stream verbatim。 |
| D-006 | REJECTED | Origin Protection 首选：Cloudflare Tunnel + Access Service Auth。 |
| D-007 | APPROVED | 删除 legacy AES / SEC_PASSWORD / SHA1 pathname mapping / x-salt。 |
| D-008 | APPROVED | Worker Rate Limiting 只用于 abuse protection，业务状态继续由 V2Board 负责。 |
| D-009 | APPROVED | 所有 V2Board Adapter fetch requests MUST use `redirect: "manual"`。对 3xx responses 由 Adapter 显式处理，严禁盲目跟随或透传。 |
| D-010 | APPROVED | Payment v1 由 V2Board 持有支付和订单状态；Gateway 只做 Contract 转换、安全过滤和 DTO 映射。 |
| D-011 | APPROVED | Account Lifecycle 使用 provider-neutral `challengeToken`；Google reCAPTCHA 仅为当前 V2Board implementation detail，Adapter 映射到 `recaptcha_data`，Gateway 不持有 anti-bot state。 |
| D-012 | APPROVED | 针对 pinned Official V2Board `99f8526eddb72a4e8f6cbccd58cc0656bb91fe88`，anti-bot acquisition 明确分类为 Google reCAPTCHA v2 visible checkbox / explicit render；`GET /api/v1/config/onboarding` 在 `provider="recaptcha"` 时公开 `mode="v2-checkbox"`。Auth mutation 仍使用 provider-neutral `challengeToken` 并由 Adapter 映射到 `recaptcha_data`；V2Board 继续权威验证，solution 不持有 anti-bot state。 |
| D-013 | APPROVED | 既有 `FRONTEND_ORIGINS` 保持 opaque secret，不读取、不替换、不迁移；新增 optional non-secret `FRONTEND_ORIGINS_EXTRA`。Effective frontend allowlist 是两者经同一严格 HTTP/HTTPS exact-origin parser 后的 Set union；wildcard、malformed、substring 与 suffix matching 均禁止。Wrangler 使用 `keep_vars` 保留远端 non-secret vars。将旧 secret 迁移为可审计 runtime config 属于后续 Runtime Config Hygiene，不在本任务执行。 |
| D-014 | APPROVED | solution 是独立 public API Gateway，Frontend domain 可替换且不构成身份。CORS 只负责 browser interoperability：Public API 固定 `Access-Control-Allow-Origin: *`，不启用 credentialed CORS；认证继续使用显式 Bearer，Origin/Referer 不参与 identity、authorization 或 ownership。`FRONTEND_ORIGINS` / `FRONTEND_ORIGINS_EXTRA` 不再被 application runtime 消费，现有 Cloudflare bindings 可暂时 dormant，安全清理由后续 Runtime Config Hygiene 执行。Checkout 仅把经过严格 exact HTTPS 语法验证的 request Origin 作为 payment return-url protocol metadata 转发；Official V2Board 继续拥有 payment business logic。 |
| D-015 | APPROVED | CF-03B 使用 V2Board visible Notice 作为 Dynamic Custom Pages 唯一 SSOT；exact lowercase `aureole:` 是 reserved control namespace。Solution request-locally 完整收集、分类和重分页，不 patch V2Board、不建立第二配置源，也绝不 server-side fetch Custom Page target。 |
| D-016 | APPROVED | A1 Registry Kernel 以 Official V2Board Admin Knowledge 作为 internal raw source；Control Plane 只提供 code-owned Knowledge list/detail read，使用 deployment-owned auth_data 与 validated Admin prefix。Registry strict validation、stable IDs/references、exposure与secret primitives保持无状态，不新增 Public route、KV或 generic Admin proxy。 |
| D-017 | APPROVED | A2 允许唯一 logical `REGISTRY_KV` 保存 derived/rebuildable Registry operational snapshot、bounded freshness 与 redacted health/alert metadata。KV 不持有业务/用户权威；refresh 仅允许 scheduled/internal 调用且不增加 Public route。 |
| D-018 | APPROVED | REG-M03 Download Center 使用 module-level exactly-two enabled `github-url-prefix` providers；Public API 只返回 provider-prefixed `downloads[]`，不提供 standalone original GitHub URL。Scheduled 对同一 repository 做 per-run request dedup，并将可重建派生 LKG 写入现有 `REGISTRY_KV`；anonymous `/api/v1/downloads` 只读该 LKG。 |

## D-005 Subscription access 实施约束

- Subscription credential APIs 以 Official `user/info` 的当前 entitlement 为统一边界：账号未 banned、`transfer_enable>0`，且 `expired_at` 为未来时间或 `null`。明确无资格不获得新 credential；字段缺失或 upstream failure 不默认放行，也不伪装为明确无资格。Legacy metadata、CF-02 compatibility、Registry delivery-options/access-link 与 rotation 复用该边界；root/prefix bearer URL 继续由 V2Board token/订阅路由权威验证。
- V2Board 继续生成和验证 normal、OTP、time-based subscription token；Gateway 不建立 token 数据库或第二套 token 算法。
- V2Board subscription route 来自固定部署配置，public request 不能选择 upstream path、origin 或额外 query。
- 成功 subscription body 使用 `Response.body` verbatim stream，不读取、不缓存、不转换协议；只转发经批准的 subscription response headers。
- subscription client `User-Agent` 仅通过显式受控通道转发，不放宽全局 header allowlist。
- CF-02 以 `pixingzoudaiyuexing/v2board@45e03f8683b549ae5f1e10b15b634ed624787d72` 的 VB-CF02-001 `GET user/getSubscribeEntries` 与 VB-CF02-002 `POST user/getSubscribeForEntry` 为当前 transitional runtime dependency。V2Board `config('v2board.subscribe_url')` 是唯一 entry SSOT；该 dependency 保留至 Registry + Solution replacement 实现并接受 equivalence/security/staging 验收。所有新工作遵循 Zero-Patch，未来升级不得默认 reapply CF-02 patch；最终方向为 Reserved Knowledge Registry configuration + Solution runtime + Official V2Board token / entitlement / content authority。移除须在独立 cleanup task 中获得 explicit authorization；Payment / Order hardening 独立于 CF-02 cleanup，不能随之移除。
- CF-02 selected-entry access 将 Browser 的 literal `baseUrl` 仅作为 JSON `base_url` 发送到固定配置的 V2Board client，由 V2Board 完成 canonicalization、exact membership、subscribe path 和 credential generation。Solution 不把该值用作 fetch target、origin、hostname、dynamic path 或 redirect，不做 prefix/base/suffix inference。
- CF-02 成功时直接返回 V2Board 生成的完整 opaque credential URL 为 `accessUrl`，不解析 token、不重建 URL，也不经过 legacy `/api/v1/access/subscription` proxy；legacy solution-owned URL 与 verbatim streaming 行为保持不变。

## D-010 Payment v1 实施约束

- V2Board 继续作为 payment/order state 的唯一 owner；Gateway 不保存支付、二维码或订单业务状态。
- Desktop QR 是 v1 首选支付体验，Client Application 通过 Order Detail 查询最终状态。
- Payment Provider callback 直接进入 V2Board，solution 不提供 callback proxy 或 webhook。
- Checkout 仅转发经过 exact HTTPS Origin 语法校验的 request Origin，作为 V2Board payment return-url protocol metadata；Origin 不表示身份或授权，且不转发浏览器控制的 Host 和 Forwarded Host/Proto headers。
- 支付过期遵循 V2Board 订单过期规则，Gateway 不创建独立 timer。官方 `wyx2685/v2board` `99f8526` 不提供权威 `expires_at` 时，Public `expiresAt` 返回 `null`；未来兼容上游提供合法值时仅验证并映射，Gateway 始终不自行计算或执行过期判断。
- Checkout v1 的 Public response types 仅为 `finished`、`qrcode` 和 `redirect`。

## D-015 Dynamic Custom Pages 实施约束

- Valid mode 仅为 exact `aureole:iframe` 或 `aureole:external`，且不能同时存在其他 `aureole:*` tag；namespace case-sensitive，`Aureole:` / `AUREOLE:` 是 ordinary。
- 所有 lowercase `aureole:*` records（valid 或 invalid）都从 ordinary Notice list/detail 隐藏；invalid reserved item 不阻断其他 valid item，但 malformed upstream structure 仍整体 fail closed。
- Solution 以固定 upstream `pageSize=100` 完整收集 visible Notices，验证稳定 total、progress 和 unique ID，再对 ordinary records 重分页；不返回 silent truncation。
- Custom Page ID 为 request-time `notice-<upstream id>`，title/content 只做 trim 和严格 HTTPS URL validation；不解析 HTML/Markdown、不提取第一条 URL、不持久化映射。
- Target URL 永不成为 Solution outbound destination，不执行 fetch、HEAD、DNS probe、redirect follow、proxy、Authorization/token injection 或 cookie bridge。
- Aureole 当前已读取 authenticated `/api/v1/custom-pages`。Notice-backed Custom Pages 是当前 transitional implementation baseline；最终方向为 Reserved Knowledge Registry -> Solution -> Aureole，迁移尚未完成。当前 Notice implementation 的替换需先有 implementation evidence、regression/security review、staging/Owner acceptance 与 explicit cleanup authorization；不定义 merge 或 runtime fallback。

## D-016 Registry Control Plane 与 Validation Kernel

- Deployment secrets `V2BOARD_CONTROL_AUTH_DATA` 和 `V2BOARD_CONTROL_ADMIN_PREFIX` 只属于 internal bootstrap。Registry、Browser、query/body/header 和用户 credential 都不能选择其值、来源、Admin operation、path 或 Knowledge ID。
- Control Plane 只允许 Official Admin Knowledge list 与由 list 内部选出的 active reserved detail read；ordinary Knowledge 与 hidden reserved records不触发 raw detail，且不存在 generic request/path/url surface 或 Admin mutation。
- Reserved Registry identity 必须同时满足 category `__AUREOLE_REGISTRY__`、title `registry:<moduleId>`、`kind=aureole.registry`、body/title moduleId 一致与 supported schema version。Reserved-invalid 不解释为 ordinary Knowledge；ordinary category 的 Registry-like JSON 仍是 ordinary。
- Envelope strict 拒绝 unknown top-level field、coercion和 future version。Validation 按 module fail closed；duplicate module/item ID、unknown references、cycles、exposure broadening和 unresolved secrets只使受影响/依赖 module失效，无关 valid module保留。
- Stable ID 是最多 64 字符的 lowercase ASCII kebab-case。Reference resolution只使用 stable module/item IDs，不 fallback 到 label、URL、V2Board numeric ID、array index或 sort order。
- Exposure maximum由代码持有：`public`、`authenticated`、`internal` 只能保持或收紧。DTO 必须从 explicit allowlist新建，禁止 raw serialization 后再 redact。
- Provider secret source 显式支持 Knowledge plaintext 或 Solution logical allowlist ref；不允许 Registry 任意读取 env key。Knowledge plaintext 是已知 confidentiality risk，但 resolved value仍不得序列化、记录或进入错误。Control Plane bootstrap auth只允许 Solution deployment boundary，不是 Registry secret。
- A1 是 source acquisition + validation kernel，不注册 Public Registry endpoint，不引入 KV/D1/DO/Cron/snapshot/health/alert，也不表示 A2 或任何 Registry consumer/module 已实现。

## D-017 Registry Operational State 实施约束

- `REGISTRY_KV` 是唯一 logical operational KV；固定 key 为 `registry:snapshot:v1`、`registry:health:v1` 与 `registry:alert:v1`。不允许 Registry、Browser、用户 ID、token 或 credential 选择 key/prefix，也不引入第二持久化技术。
- Snapshot schema version 为 1。Validated config 只能进入 code-owned per-module safe projector，再经 module-specific snapshot schema 验证后持久化；禁止直接序列化 `RegistryModuleResult.useConfig()`、raw Admin response 或 raw Knowledge body。
- Knowledge plaintext secret 与 resolved Solution secret 永不持久化。Solution secret source 最多保留 validated logical ref；Knowledge source 最多保留不含 value 的 source classification。Fingerprint 仅来自 canonical safe normalized data，只是 content/correlation metadata，不是 MAC 或 freshness authority；freshness 由显式 temporal validation、`validatedAt`、code-owned policy 与 current clock 决定。
- Latest validation state 与 LKG 独立保存。Source failure 或 invalid module 不覆盖既有 valid LKG；unrelated valid module 可更新；disabled/absent module 不保留活动 config。LKG 只有在 code-owned freshness bound 内可用。
- Freshness class 仅由代码定义为 `STALE_TOLERANT` 或 `FRESH_REQUIRED`，positive max age 同样由代码持有。`age <= maxAge` 可用，`age > maxAge` 不可用；KV TTL 不是 correctness/security authority，也不提供 immediate/linearizable revocation。
- Worker 可增加 internal scheduled handler 调用 refresh，但不增加 Registry/health/refresh Public route。Production KV namespace/binding 和 Cron cadence 需独立部署授权；A2 不实现 Telegram/webhook delivery、live provider probe 或产品 module。
- Cloudflare KV eventual consistency 与无 transactional CAS 是明确限制；A2 不提供 global linearizable refresh ordering 或 immediate revocation。Source-level failure不写 snapshot，每个成功持久化 candidate 必须独立通过 strict schema、module snapshot schema 与 safe fingerprint validation。

## D-018 REG-M03 Download Center 实施约束

- Registry 只允许 strict `owner/repo`、literal `release=latest`、bounded literal matcher 与 module-level `github-url-prefix` providers；不能提供 arbitrary API URL、regex、expression、JavaScript、credential、per-item provider override 或 template language。
- `downloadProviders` 最多 8 个，stable IDs 唯一；provider base URL 必须是 bounded HTTPS deterministic prefix，无 userinfo/query/fragment/control/template syntax，并以 `/` 结尾。`defaultDownloadProviderIds` 必须恰好包含两个不同且 enabled 的 provider IDs。Provider URL 通过 literal `baseUrl + validated GitHub browser_download_url` 生成，不 encode 完整 GitHub URL，Solution 不 fetch provider URL。
- GitHub adapter 固定使用 `https://api.github.com/repos/{owner}/{repo}/releases/latest`、manual redirect、10-second timeout、512 KiB body bound、100-asset bound和显式字段长度限制。可选 `GITHUB_API_TOKEN` 只能来自 Solution deployment secret，必须是 1..512 字符的 visible ASCII，并只用于固定 GitHub request 的 `Authorization: Bearer`；不得由 Registry/Browser选择，也不得进入 Registry/KV/Public DTO/log/error。未配置时保持 unauthenticated request。
- Matcher 对 bounded filename metadata执行 case-insensitive literal comparison；exactly one candidate 才成功，zero/multiple 都 unavailable。Selected URL 必须验证为 matching repository/tag/filename 的 GitHub HTTPS release download URL。
- Scheduled 保持一个 `waitUntil`，内部顺序执行 Registry refresh 与 external resolution。单次 run 使用 bounded in-memory normalized repository Promise cache；同一 `owner/repo` 的 due items 共享一个 latest-release result。失败按 repository/item 隔离，无 retry loop；`lastAttemptAt` 控制 refresh interval。
- 派生 key 保持 `registry:download-center:resolved:v1`，payload schema version 为 `2`；旧 v1 payload fail closed。只保存 normalized public provider-prefixed metadata和必要 timestamp/effective fingerprint；raw GitHub/Registry payload、standalone original URL field、provider baseUrl config、repository matcher、secret、user/account/entitlement/subscription/business state 不得持久化。
- Effective fingerprint 必须包含 item config、两个 selected providers 的 ID/label/type/baseUrl 和顺序。Provider config/order 变化后，旧 generated URLs 不能作为新配置 LKG 继续提供。
- `GET /api/v1/downloads` 是 anonymous neutral collection。它不发起任何 outbound request；missing/corrupt/expired/unavailable item 被省略，empty collection仍为 HTTP 200。没有新的 Public health/registry/refresh/control-plane route，也不改变 V2Board authority。
- M03 v1 platform 只允许 Windows、Mac、Android 和 Linux items；多个 Linux items 由 Aureole 分组为一个 `Linux GUI` section。`ios` 保留给未来 separately approved non-download destination，当前不返回 item/card/CTA/URL，也不提前定义 destination semantics。
- Scheduled GitHub repository diagnostics 使用同一个 `REGISTRY_KV` 的 fixed internal key `registry:download-center:diagnostic:v1`。每次 due run 只记录实际 attempted unique normalized repositories，最多 50 项；允许 `success` 或 strict `TIMEOUT/RATE_LIMITED/FETCH_REJECTED/HTTP_REDIRECT/HTTP_ERROR/UPSTREAM_ERROR/INVALID_RESPONSE/RESPONSE_TOO_LARGE/UNEXPECTED`，以及 bounded attemptedAt/elapsedMs。`HTTP_REDIRECT` 必须携带 300..399 status，`HTTP_ERROR` 必须携带非成功且非 rate-limit status，`RATE_LIMITED` 可携带 403/429；无 Response 的分类禁止 `httpStatus`。现有 v1 `UPSTREAM_ERROR` 记录继续兼容读取，但新可区分路径不再折叠到该 code。No-due run 保留上一份有用证据；diagnostic 写失败必须被忽略，不能改变 GitHub Promise 结果、resolved LKG、fallback 或 Public API。禁止 raw response/body/header、provider URL、secret、stack/cause/error message 与 Public endpoint。
- Cloudflare/workerd native fetch 具有 receiver 约束。GitHub adapter 必须把默认或注入 fetch 包装为 arrow/bare invocation；不得通过 `this.fetcher(...)` 把 adapter 实例作为 native fetch receiver。该约束只修正 invocation receiver，不改变 fetch injection、request construction、timeout、retry、headers、redirect、endpoint 或错误分类。
