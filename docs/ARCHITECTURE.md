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

## v1 永久 Non-goals

- Telegram bind/unbind/login/Public API；V2Board 内部管理员通知 side effect 不属于 solution dependency。
- Knowledge / 知识库 list/detail/content transformation，以及其中的 subscription URL/token replacement。
- Multi-level commission distribution；所有部署必须保持 `commission_distribution_enable=0`，不支持 fractional pending commission。
