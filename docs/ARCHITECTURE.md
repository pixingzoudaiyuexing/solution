# Architecture

## 核心架构设计

`solution` 采用模块化单 Worker 架构，严格划分为 Gateway 层和 Adapter 层。

```text
Client Application
   │
   │ HTTPS + Stable Public Contract
   ▼
┌──────────────────────────────────────┐
│ Cloudflare Worker: solution          │
│                                      │
│ Gateway                              │
│ ├─ Routing                           │
│ ├─ Validation                        │
│ ├─ CORS                              │
│ ├─ Authorization                     │
│ ├─ Controlled Header Forwarding      │
│ ├─ Error Normalization               │
│ └─ Public Contract                   │
│                  │                   │
│                  ▼                   │
│ V2Board Adapter                      │
│ ├─ Auth translation                  │
│ ├─ Path mapping                      │
│ ├─ Request mapping                   │
│ ├─ Response mapping                  │
│ └─ Streaming                         │
└──────────────────┬───────────────────┘
                   │
                   │ HTTPS
                   ▼
         Publicly Reachable V2Board
```

## 网络与安全模型
- **业务无状态**: 不使用 KV/D1/Durable Objects 存储用户、订单、支付、订阅、身份或其他业务权威。A2 仅允许一个 `REGISTRY_KV` 保存可从 V2Board reserved Knowledge 重建的 Registry operational snapshot、freshness 与 redacted health/alert metadata；删除该 KV 不损失任何业务事实。
- **认证边界**: Gateway 将 V2Board `auth_data` 视为 opaque credential，通过 Public Bearer Contract 接收并受控转发，由 V2Board 完成验证；Gateway 不解析 Token、不自建 Session。
- **Origin 暴露**: V2Board 保持公网可达（满足 Admin / Node / Payment Provider 直连需求）。Gateway 仅通过 DTO 层提供 API 抽象与后端隐藏，不实施强制网络隔离（Mandatory Access Control）。
- **Callback 路由**: 支付回调直接进入 V2Board 域名，不经过 Gateway。
- **速率限制**: solution 当前没有 Gateway rate limiter、WAF、CAPTCHA 或 challenge service。Account Lifecycle 仅提供 provider-neutral `challengeToken`，Adapter 按官方 V2Board 实现映射为 `recaptcha_data`；实际验证和限流由 V2Board 持有。
- **Observability 与 URL credential**: subscription access 使用 URL credential。Cloudflare persistent observability 保持 `redact_query_string=true`，并设置 `invocation_logs=false`；application code 不主动记录 token。Cloudflare real-time Tail 是可能包含完整 request URL/query credential 的特权运维接口，拥有 Workers Tail Read 或 Workers Scripts Write 的主体必须视为 trusted privileged operator。production 不向不可信人员授予这些权限，也不长期保存或公开分享 Tail 输出；不因该平台特性改变 subscription Public Contract。
- **CF-02 subscription entry authority**: `pixingzoudaiyuexing/v2board@45e03f8683b549ae5f1e10b15b634ed624787d72` 的 `GET user/getSubscribeEntries`（VB-CF02-001）与 `POST user/getSubscribeForEntry`（VB-CF02-002）是 Multiple Subscription Entries 当前的 transitional compatibility dependency。V2Board `config('v2board.subscribe_url')` 是唯一 entry SSOT，并继续负责 canonicalization、exact membership、subscribe path 以及 normal/OTP/time-based credential generation。Solution 只读取 entry、把 Browser 选择的 literal `baseUrl` 作为 JSON 字段发送到固定可信 V2Board client，并把完整 `subscribe_url` 当作 opaque `accessUrl` 返回。Browser 值绝不能控制 outbound origin/path/hostname，Solution 不建立第二配置源、不解析 token、不做 prefix/base/suffix inference。所有新 CC 开发遵循 V2Board Zero-Patch；最终方向是 Reserved Knowledge Registry configuration + Solution runtime + Official V2Board token / entitlement / content authority。当前 dependency 保留至 verified replacement 与 explicit cleanup authorization；未来升级不得默认 reapply CF-02 patches，且 Payment / Order hardening 与 CF-02 cleanup 相互独立。
- **Legacy subscription proxy isolation**: `GET /api/v1/subscription` 与 `GET /api/v1/access/subscription?token=...` 继续提供既有 solution-owned URL 和 verbatim streaming。CF-02 selected-entry flow 不经过 legacy proxy，也不改变其行为。
- **REG-M02 Custom Pages Registry source migration**: `GET /api/v1/custom-pages` 保留 authenticated path/DTO/bookmark-compatible stable IDs，但 runtime authority 已迁移为 `Authenticated Browser -> Bearer syntax gate -> Official V2Board user/info session validation -> A2 REGISTRY_KV custom-pages snapshot -> explicit Custom Pages DTO`。`custom-pages` module 是 authenticated、code-owned 86400-second `STALE_TOLERANT` Registry consumer；Registry unavailable后在 session validation 成功时返回 empty items，不回退到 Notice，也不与 Notice merge。Data plane 不调用 Admin Knowledge、Control Plane、refresh、Notice API或 target URL。普通 Notice list/detail 仍以 existing Notice adapter 提供，并继续隐藏 lowercase `aureole:*` rows；legacy Notice data 保留到单独 cleanup/cutover authorization。
- **A1 Registry Control Plane**: Official V2Board Admin Knowledge 是 reserved Registry raw source，仍由 V2Board 持有数据与 Admin 权限。Solution 通过 internal-only `V2BoardControlPlaneClient` 使用 deployment secrets `V2BOARD_CONTROL_AUTH_DATA` 与 `V2BOARD_CONTROL_ADMIN_PREFIX`，只允许 code-owned Knowledge list/detail read；list 先筛选 exact category `__AUREOLE_REGISTRY__`，仅 active reserved records 读取 raw detail。没有 generic Admin proxy、Admin mutation、Public Registry route或 data-plane-triggered Admin fetch。Admin prefix 不能包含 origin、absolute path、query/hash、percent encoding、backslash 或 traversal，并继续受固定 HTTPS V2Board `/api/v1/` base、manual redirect、header allowlist 与 timeout 保护。
- **A1 Registry validation kernel**: Registry envelope 使用 strict JSON、exact identity 与 schema version 1；reserved-invalid 不回退为 ordinary Knowledge，一个 invalid/duplicate/dependency-invalid module 不使无关 valid module失效。Stable ID、acyclic references、code-owned exposure maximum、allowlist DTO projection 与 dual provider Secret Source（Knowledge plaintext / Solution logical allowlist ref）均为 internal primitives。Bootstrap Control Plane credential 永远是 deployment-owned solution secret，不经过 Registry Secret Source。A1 不持久化 snapshot、不增加 KV/D1/DO/Cron/health scheduler，raw Admin payload、Knowledge body、credentials 与 resolved secrets不进入日志、错误、DTO 或 fingerprint。
- **A2 Registry operational state**: `REGISTRY_KV` 是唯一 logical operational KV binding，固定 keyspace 为 `registry:snapshot:v1`、`registry:health:v1` 与 `registry:alert:v1`。Snapshot schema version 为 1；每个 module 必须通过 code-owned safe projector 与 module-specific snapshot schema 后才可持久化。`source=solution` 最多保留 validated logical ref，`source=knowledge` 只保留 source classification，plaintext/resolved secret、raw Admin response 与 raw Knowledge body 永不进入 KV。Latest validation state 与 LKG 分离；invalid/source failure 不覆盖 good LKG，disabled/absent module 不保留活动 config。Freshness policy 仅由代码定义为 `STALE_TOLERANT` 或 `FRESH_REQUIRED`，显式用 `validatedAt` 与 positive bound 判断，KV TTL 不构成安全边界。
- **A2 refresh/health boundary**: Worker default export 保留 Hono fetch delegation，并新增 internal `scheduled()` boundary；scheduled 只调用一次 internal refresh，不注册 Public route。Control Plane -> A1 validation -> safe projection -> KV snapshot/health/alert 是唯一 refresh pipeline。Health 仅使用 `ok/degraded/error/disabled` 与 normalized safe metadata；alert foundation 只记录安全 fingerprint、failure streak 与 recovery pending，不发送 Telegram/webhook。Cloudflare KV 是 eventually consistent 且无 transactional CAS；A2 不宣称 global linearizable refresh ordering，每个已写 candidate 必须独立通过 schema/fingerprint validation。Production KV namespace、binding 与 Cron cadence 尚未 provision/activate；production operational module definitions 当前为空。
- **A3 first Registry data-plane consumer**: `GET /api/v1/config/runtime` 是首个 Browser-facing Registry consumer，只读取 A2 `REGISTRY_KV` 中已验证且在 code-owned 24-hour `STALE_TOLERANT` bound 内的 `runtime-settings` safe snapshot，并逐字段构造七字段 Public DTO。Flow 为 `Browser -> config/runtime -> A2 snapshot reader -> explicit Runtime Settings DTO`。该 request 不调用 Admin Knowledge、Control Plane、refresh、V2Board 或 external provider；missing/corrupt/disabled/absent/stale state 统一返回 all-null 200 fallback，不公开 Registry metadata。A3 只注册 REG-M01，不实现 REG-M07 或其他 product module。
- **M11 promotion UI data-plane**: Reserved Knowledge `promotion-ui` 只保存页面展示开关和可公开的年付预填码；沿用 A2 的严格 module validation、safe projector、单一 `REGISTRY_KV` 和内部定时刷新。匿名 `GET /api/v1/config/promotion-ui` 只读 safe snapshot、只返回两字段 allowlist DTO；latest 非 `VALID_ENABLED` 或 snapshot 不可用时返回“手动入口开启、无预填码”，入口明确关闭时不持久化或公开旧码。该 GET 不验证优惠券、不查询 V2Board、不建单。真正的页面交互属于后续 Aureole，优惠券和订单权威仍属于 V2Board。
- **Retired external support widget**: CC-D024 已取消该功能。当前 Worker source 不注册旧 Widget Registry module 或 Public route，也不能从 Reserved Knowledge 重新激活第三方客服。包含旧模块条目的历史 operational snapshot 会被当前 module allowlist 判为不可用；Browser-facing Registry consumers 按各自 fallback fail closed，下一次正常 scheduled refresh 按当前 module set 重写 snapshot。历史 Git/Worker 版本仍保留，不等于当前可执行路径。
- **REG-M04/M06 Subscription Delivery**: `SOL-REG-M04-M06-01` is `PASS / COMPLETE / CLOSED / RE-FROZEN`; anchors are initial implementation `96bfcb37ffa02589ee2566399a0f19816ac999b6`, security/final runtime fix `92a9a432b46707b011c3456018fc15d836277ab1`, and final independently reviewed/current main `c884a73d93e240e2dddc7ea9f4e8ab58dffb736b`. Gemini is `PASS / 0 BLOCKER / 0 HIGH / 0 MEDIUM / 0 LOW`. New-link flow为 `Bearer -> Official user/info current-entitlement gate -> A2 subscription-delivery snapshot -> Official user/getSubscribe normal-token equality proof -> generated public bearer URL`。Current entitlement 精确镜像 Official `UserService::isAvailable()` 的未 banned、正 `transfer_enable`、未过期或永久条件，不以历史订单为资格权威。Registry仅持有presentation/routing config，不持有token/user/entitlement；hidden V2Board hostname conflict在consumer boundary对整模块fail closed。Existing bearer refresh为 `root token path -> fixed hidden origin/path -> D-005 verbatim stream`，完全不读取Registry或用户业务API。`info=hide`只移除`subscription-userinfo`，不修改body；legacy CF-02 entries/entry-access与legacy `/api/v1/access/subscription`保持可达，M05未实现。Aureole与V2Board保持不变，CF-02仍为 live / not cleaned up，REG-M07未实现，Production未部署。

## 当前未实现能力与业务 Non-goals

- **普通 User Knowledge / Help Center**：当前没有 Browser/Public ordinary Knowledge contract。已冻结但尚未实现的方向为 ordinary V2Board Knowledge -> Solution safe adapter -> Aureole native Help Center。Reserved `__AUREOLE_REGISTRY__` 严格属于 internal Registry Control Plane；ordinary Knowledge 不得因正文类似 Registry JSON 而成为 Registry，reserved records 也不得泄露到 Help Center。
- **Telegram Registry Ops**：当前未实现，不存在 bot、scheduler、alerts 或 Telegram runtime。已冻结但尚未实现的方向为 owner-only、read-only 的 Registry health / check / alert surface。V2Board 内部管理员通知 side effect 不属于 solution dependency。
- Multi-level commission distribution；所有部署必须保持 `commission_distribution_enable=0`，不支持 fractional pending commission。
