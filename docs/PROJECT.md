# Project solution

## 概述
`solution` 是一个基于 Cloudflare Workers 构建的完全无状态 V2Board API Adapter / Backend Bridge。
它通过稳定的 `v1` Public API Contract 隔离 Consumer 与 V2Board 实现细节，并重塑过时的遗留客户端中间件逻辑。

## 目标
- 提供稳定且解耦的 Public API Contract (`/api/v1`)。
- 隐藏 V2Board 原始 API path、内部 DTO/model 和 Laravel/V2Board 原始错误，避免 Consumer 绑定上游实现。
- 剥离原有的业务层 AES 加密等遗留安全债。
- 保持 Gateway 无状态；V2Board 可以继续公网可达，不要求 Cloudflare Tunnel、Access 或强制网络隔离。

## 当前实现状态
当前状态基于 Phase 2L — V1 Contract Freeze / Production Readiness，结论为：

```text
V1 CONTRACT BASELINE FROZEN
```

CF-03B Dynamic Custom Pages 以向后兼容的 additive extension 新增 authenticated `/api/v1/custom-pages`；真实 source route tree 包含 47 个 `/api/v1` Public routes。V2Board visible Notice 是 Custom Page 唯一 SSOT；Solution request-locally 完整收集、分类、过滤并重分页，不保存第二配置源或 fetch target URL。已有 v1 Contract baseline 保持冻结；完整 METHOD、PATH、DTO、错误与分页契约以 `docs/API-CONTRACT.md` 为 SSOT。

Gateway 只转换 Contract、过滤字段、规范化错误并受控转发；V2Board 继续拥有验证码、注册规则、用户、订单、支付、subscription、ticket、notice、knowledge、traffic、invite、commission 和所有业务状态。Payment Provider callback 仍直接进入 V2Board。

A1 `SOL-REG-KERNEL-01` 增加 internal-only Control Plane 与 Registry validation primitives，不增加 Public API。Official Admin Knowledge 是 reserved Registry raw source；Solution 只通过 deployment-owned `V2BOARD_CONTROL_AUTH_DATA` 和 `V2BOARD_CONTROL_ADMIN_PREFIX` 执行 code-owned list/detail read。Registry Kernel 严格验证 identity/envelope/module schema、stable IDs/references、exposure、DTO allowlist与provider secrets，并保持 module-level fail closed。A1 不增加 KV/snapshot/scheduler，不让 Browser request触发 Admin fetch，也不修改 V2Board 或 Aureole。

V2Board-first Business Ownership：官方 V2Board 已支持的业务规则、金额计算、资格、transaction、state mutation 和 callback 继续由 V2Board 持有；solution 只做 Public Contract、验证、安全过滤和 Adapter 映射。Coupon Application 只把 `promotionCode` 映射为 `coupon_code`，不预查、不计算折扣/价格/VIP/余额，也不保存 coupon state。

Phase 2V 的 Product Detail 只将 `GET /api/v1/products/{id}` 映射为一次 `GET user/plan/fetch?id={id}`。hidden/current/renewable Plan 的可见性和最终购买资格仍完全由 V2Board 决定；Gateway 不预读用户或套餐、不计算容量、不比较 current plan，也不复制 `show` / `renew` 逻辑。详情成功不代表 Order Create 成功，`user/order/save` 仍是最终权威。

Phase 2W 为 onboarding requirements、current preferences 和 currency 提供三个彼此独立的最小白名单 DTO。每个 route 只请求一个 Official endpoint；Gateway 不推断 registration availability、不聚合 mega-config、不暴露 app URL/Stripe/Telegram/withdrawal/multi-level commission 配置，也不缓存 config 或 preference state。针对当前 pinned Official V2Board `99f8526eddb72a4e8f6cbccd58cc0656bb91fe88`，anti-bot capability discovery 在 enabled 时稳定返回 `provider="recaptcha"` 与 `mode="v2-checkbox"`；该 classification 来自 Official default frontend 的 visible checkbox / explicit-render acquisition model，不增加其他 provider/mode。Auth mutation 契约仍保持 provider-neutral `challengeToken`，Adapter 映射到 `recaptcha_data`，V2Board 继续执行权威验证，Gateway 不持有 anti-bot state。

Wallet Balance Read 只把官方 `user/info.balance` 原样映射为 `balanceMinor`。Wallet Deposit 仅映射 V2Board 原生 `plan_id=0/period=deposit` Order Create；Gateway 不计算、合并、缓存或修改余额，不计算 bonus，也不持有 checkout、callback 或支付状态。Deposit、commission transfer、Gift Card、订单抵扣和 cancellation/refund 继续由 V2Board 持有。

Telegram Public API、普通 User Knowledge / Help Center Public API 和 multi-level commission distribution 是当前明确 Non-goals。Reserved Admin Knowledge 只用于 internal Registry raw source，不改变普通 Knowledge 的 Public边界。多级分销部署必须保持 `commission_distribution_enable=0`。Commission Transfer 与 Withdrawal Request 都只映射官方 API；余额、资格、minimum、事务和 Ticket 创建由 V2Board 拥有。Subscription Rotation 的 token/UUID 与 Advance Period 的流量/有效期 mutation同样由 V2Board 生成、计算和保存；Gateway 不 pre-check、不计算周期、不 retry、不保存 mutation state。Gift Card 管理/创建/list/preview、Active Session、Quick Login、automatic payout、withdrawal admin，以及直接暴露 upstream `newPeriod` / `resetSecurity` 命名不属于 v1 Public Contract。

## 运行时配置
- Public API CORS 固定使用 `Access-Control-Allow-Origin: *`，不输出 `Access-Control-Allow-Credentials`。Frontend domain 是可替换的 browser client location，不是 authentication / authorization identity；更换域名不要求修改 solution 配置或重新部署 solution。
- 历史 Cloudflare bindings `FRONTEND_ORIGINS` 与 `FRONTEND_ORIGINS_EXTRA` 可暂时继续存在，但 application runtime 不再读取。它们属于 dormant bindings；后续 Runtime Config Hygiene 可在独立、可审计任务中安全清理，本任务不读取、替换或删除其值。
- `V2BOARD_BASE_URL`: V2Board API v1 基础地址，必须使用 HTTPS，例如 `https://backend.example/api/v1/`；末尾缺少 `/` 时客户端会自动补齐。
- `V2BOARD_SUBSCRIBE_PATH`: V2Board 上固定的 subscription route，例如 `/client/subscribe`。必须是根相对路径；不能包含 origin、query、fragment、反斜线、percent encoding 或 traversal。
- `V2BOARD_CONTROL_AUTH_DATA`: internal Control Plane bootstrap credential；必须以 Solution deployment secret人工 provision。Solution 不保存 Admin password、不自动登录，也不允许 Registry选择此 credential。
- `V2BOARD_CONTROL_ADMIN_PREFIX`: internal deployment-owned V2Board Admin secure prefix；必须使用安全 relative prefix，不能包含 origin、leading slash、backslash、query、fragment、percent encoding 或 traversal。Browser/Public input永远不能选择该值。

当前冻结部署不使用 `V2BOARD_ACCESS_CLIENT_ID`、`V2BOARD_ACCESS_CLIENT_SECRET`、Cloudflare Access 或 Tunnel。Payment Provider 协议必须携带的 `notify_url` / callback hostname 由 V2Board 管理，solution 不代理、重写或持有 callback 和支付状态。

## 目录结构规划
- `src/`: 源代码
  - `contract/`: 公网 API 协议定义
  - `routes/`: 公网 API 路由处理
  - `adapters/v2board/`: 专门与 V2Board 交互的防腐层
  - `http/`: CORS, Header 和 Request/Response 工具
  - `security/`: Authorization、CORS、URL、User-Agent 与 subscription 安全策略
- `test/`: 单元与集成测试
- `docs/`: 架构与设计文档
