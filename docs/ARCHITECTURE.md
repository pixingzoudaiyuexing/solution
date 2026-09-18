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
- **无状态**: 不使用 KV/D1/Durable Objects 存储业务数据。
- **认证边界**: Gateway 将 V2Board `auth_data` 视为 opaque credential，通过 Public Bearer Contract 接收并受控转发，由 V2Board 完成验证；Gateway 不解析 Token、不自建 Session。
- **Origin 暴露**: V2Board 保持公网可达（满足 Admin / Node / Payment Provider 直连需求）。Gateway 仅通过 DTO 层提供 API 抽象与后端隐藏，不实施强制网络隔离（Mandatory Access Control）。
- **Callback 路由**: 支付回调直接进入 V2Board 域名，不经过 Gateway。
- **速率限制**: solution 当前没有 Gateway rate limiter、WAF、CAPTCHA 或 challenge service。Account Lifecycle 仅提供 provider-neutral `challengeToken`，Adapter 按官方 V2Board 实现映射为 `recaptcha_data`；实际验证和限流由 V2Board 持有。
- **Observability 与 URL credential**: subscription access 使用 URL credential。Cloudflare persistent observability 保持 `redact_query_string=true`，并设置 `invocation_logs=false`；application code 不主动记录 token。Cloudflare real-time Tail 是可能包含完整 request URL/query credential 的特权运维接口，拥有 Workers Tail Read 或 Workers Scripts Write 的主体必须视为 trusted privileged operator。production 不向不可信人员授予这些权限，也不长期保存或公开分享 Tail 输出；不因该平台特性改变 subscription Public Contract。
- **CF-02 subscription entry authority**: `pixingzoudaiyuexing/v2board@45e03f8683b549ae5f1e10b15b634ed624787d72` 的 `GET user/getSubscribeEntries`（VB-CF02-001）与 `POST user/getSubscribeForEntry`（VB-CF02-002）是 Multiple Subscription Entries 的冻结 compatibility dependency。V2Board `config('v2board.subscribe_url')` 是唯一 entry SSOT，并继续负责 canonicalization、exact membership、subscribe path 以及 normal/OTP/time-based credential generation。Solution 只读取 entry、把 Browser 选择的 literal `baseUrl` 作为 JSON 字段发送到固定可信 V2Board client，并把完整 `subscribe_url` 当作 opaque `accessUrl` 返回。Browser 值绝不能控制 outbound origin/path/hostname，Solution 不建立第二配置源、不解析 token、不做 prefix/base/suffix inference。
- **Legacy subscription proxy isolation**: `GET /api/v1/subscription` 与 `GET /api/v1/access/subscription?token=...` 继续提供既有 solution-owned URL 和 verbatim streaming。CF-02 selected-entry flow 不经过 legacy proxy，也不改变其行为。
- **CF-03B Dynamic Custom Pages**: V2Board Notice 是 Custom Page management/data SSOT，V2Board 保持不变。Solution 每次请求通过固定可信 V2Board origin 完整收集 visible Notices，以 case-sensitive lowercase `aureole:` tags 分类 control records；ordinary Notice list request-locally 过滤后重分页，`GET /api/v1/custom-pages` 只返回 `id/title/url/mode`。Reserved semantic-invalid item 单项 fail closed 并隐藏，upstream structural corruption 仍使请求整体 fail closed。Solution 不保存第二配置源、不缓存、不读取数据库，也绝不 fetch/HEAD/DNS probe/proxy Custom Page target 或向其注入 credential。未来 Aureole migration 后，`V2Board Notice -> Solution /custom-pages` 将成为单一 runtime Custom Page SSOT；当前 Aureole 未修改，不设计 static merge 或 runtime fallback。
- **A1 Registry Control Plane**: Official V2Board Admin Knowledge 是 reserved Registry raw source，仍由 V2Board 持有数据与 Admin 权限。Solution 通过 internal-only `V2BoardControlPlaneClient` 使用 deployment secrets `V2BOARD_CONTROL_AUTH_DATA` 与 `V2BOARD_CONTROL_ADMIN_PREFIX`，只允许 code-owned Knowledge list/detail read；list 先筛选 exact category `__AUREOLE_REGISTRY__`，仅 active reserved records 读取 raw detail。没有 generic Admin proxy、Admin mutation、Public Registry route或 data-plane-triggered Admin fetch。Admin prefix 不能包含 origin、absolute path、query/hash、percent encoding、backslash 或 traversal，并继续受固定 HTTPS V2Board `/api/v1/` base、manual redirect、header allowlist 与 timeout 保护。
- **A1 Registry validation kernel**: Registry envelope 使用 strict JSON、exact identity 与 schema version 1；reserved-invalid 不回退为 ordinary Knowledge，一个 invalid/duplicate/dependency-invalid module 不使无关 valid module失效。Stable ID、acyclic references、code-owned exposure maximum、allowlist DTO projection 与 dual provider Secret Source（Knowledge plaintext / Solution logical allowlist ref）均为 internal primitives。Bootstrap Control Plane credential 永远是 deployment-owned solution secret，不经过 Registry Secret Source。A1 不持久化 snapshot、不增加 KV/D1/DO/Cron/health scheduler，raw Admin payload、Knowledge body、credentials 与 resolved secrets不进入日志、错误、DTO 或 fingerprint。

## v1 永久 Non-goals

- Telegram bind/unbind/login/Public API；V2Board 内部管理员通知 side effect 不属于 solution dependency。
- 普通 User Knowledge / Help Center Public Contract、正文转换以及 subscription URL/token replacement。Exact reserved Admin Knowledge 仅作为 internal Registry source，不属于 Browser/Public Knowledge API。
- Multi-level commission distribution；所有部署必须保持 `commission_distribution_enable=0`，不支持 fractional pending commission。
