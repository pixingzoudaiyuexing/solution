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

## D-005 Subscription access 实施约束

- Legacy `GET /api/v1/subscription` metadata 仅向 V2Board 订单历史中存在成功订阅生命周期的 previous purchaser 提供 solution-owned access URL；pending、cancelled 和 deposit-only 用户不获得 URL。CF-02 entry discovery 与 selected-entry access 复用完全相同的 eligibility boundary。
- V2Board 继续生成和验证 normal、OTP、time-based subscription token；Gateway 不建立 token 数据库或第二套 token 算法。
- V2Board subscription route 来自固定部署配置，public request 不能选择 upstream path、origin 或额外 query。
- 成功 subscription body 使用 `Response.body` verbatim stream，不读取、不缓存、不转换协议；只转发经批准的 subscription response headers。
- subscription client `User-Agent` 仅通过显式受控通道转发，不放宽全局 header allowlist。
- CF-02 以 `pixingzoudaiyuexing/v2board@45e03f8683b549ae5f1e10b15b634ed624787d72` 的 VB-CF02-001 `GET user/getSubscribeEntries` 与 VB-CF02-002 `POST user/getSubscribeForEntry` 为冻结依赖。V2Board `config('v2board.subscribe_url')` 是唯一 entry SSOT；未来升级必须保留或提供等价 capability。
- CF-02 selected-entry access 将 Browser 的 literal `baseUrl` 仅作为 JSON `base_url` 发送到固定配置的 V2Board client，由 V2Board 完成 canonicalization、exact membership、subscribe path 和 credential generation。Solution 不把该值用作 fetch target、origin、hostname、dynamic path 或 redirect，不做 prefix/base/suffix inference。
- CF-02 成功时直接返回 V2Board 生成的完整 opaque credential URL 为 `accessUrl`，不解析 token、不重建 URL，也不经过 legacy `/api/v1/access/subscription` proxy；legacy solution-owned URL 与 verbatim streaming 行为保持不变。

## D-010 Payment v1 实施约束

- V2Board 继续作为 payment/order state 的唯一 owner；Gateway 不保存支付、二维码或订单业务状态。
- Desktop QR 是 v1 首选支付体验，Client Application 通过 Order Detail 查询最终状态。
- Payment Provider callback 直接进入 V2Board，solution 不提供 callback proxy 或 webhook。
- Checkout 仅转发经过 exact HTTPS Origin 语法校验的 request Origin，作为 V2Board payment return-url protocol metadata；Origin 不表示身份或授权，且不转发浏览器控制的 Host 和 Forwarded Host/Proto headers。
- 支付过期遵循 V2Board 订单过期规则，Gateway 不创建独立 timer。官方 `wyx2685/v2board` `99f8526` 不提供权威 `expires_at` 时，Public `expiresAt` 返回 `null`；未来兼容上游提供合法值时仅验证并映射，Gateway 始终不自行计算或执行过期判断。
- Checkout v1 的 Public response types 仅为 `finished`、`qrcode` 和 `redirect`。
