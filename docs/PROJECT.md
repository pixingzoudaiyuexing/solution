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

Phase 2W 以向后兼容的 additive extension 新增 Minimal Account / Onboarding Config；真实 source route tree 包含 44 个 `/api/v1` Public routes。已有 v1 Contract baseline 保持冻结；完整 METHOD、PATH、DTO、错误与分页契约以 `docs/API-CONTRACT.md` 为 SSOT。

Gateway 只转换 Contract、过滤字段、规范化错误并受控转发；V2Board 继续拥有验证码、注册规则、用户、订单、支付、subscription、ticket、notice、traffic、invite、commission 和所有业务状态。Payment Provider callback 仍直接进入 V2Board。

V2Board-first Business Ownership：官方 V2Board 已支持的业务规则、金额计算、资格、transaction、state mutation 和 callback 继续由 V2Board 持有；solution 只做 Public Contract、验证、安全过滤和 Adapter 映射。Coupon Application 只把 `promotionCode` 映射为 `coupon_code`，不预查、不计算折扣/价格/VIP/余额，也不保存 coupon state。

Phase 2V 的 Product Detail 只将 `GET /api/v1/products/{id}` 映射为一次 `GET user/plan/fetch?id={id}`。hidden/current/renewable Plan 的可见性和最终购买资格仍完全由 V2Board 决定；Gateway 不预读用户或套餐、不计算容量、不比较 current plan，也不复制 `show` / `renew` 逻辑。详情成功不代表 Order Create 成功，`user/order/save` 仍是最终权威。

Phase 2W 为 onboarding requirements、current preferences 和 currency 提供三个彼此独立的最小白名单 DTO。每个 route 只请求一个 Official endpoint；Gateway 不推断 registration availability、不聚合 mega-config、不暴露 app URL/Stripe/Telegram/withdrawal/multi-level commission 配置，也不缓存 config 或 preference state。Anti-bot capability discovery 可返回当前 `recaptcha` provider，Auth mutation 契约仍保持 provider-neutral `challengeToken`。

Wallet Balance Read 只把官方 `user/info.balance` 原样映射为 `balanceMinor`。Wallet Deposit 仅映射 V2Board 原生 `plan_id=0/period=deposit` Order Create；Gateway 不计算、合并、缓存或修改余额，不计算 bonus，也不持有 checkout、callback 或支付状态。Deposit、commission transfer、Gift Card、订单抵扣和 cancellation/refund 继续由 V2Board 持有。

Telegram、Knowledge / 知识库和 multi-level commission distribution 是明确且永久的 Non-goals。多级分销部署必须保持 `commission_distribution_enable=0`。Commission Transfer 与 Withdrawal Request 都只映射官方 API；余额、资格、minimum、事务和 Ticket 创建由 V2Board 拥有。Subscription Rotation 的 token/UUID 与 Advance Period 的流量/有效期 mutation 同样由 V2Board 生成、计算和保存；Gateway 不 pre-check、不计算周期、不 retry、不保存 mutation state。Gift Card 管理/创建/list/preview、Active Session、Quick Login、automatic payout、withdrawal admin，以及直接暴露 upstream `newPeriod` / `resetSecurity` 命名不属于 v1 Public Contract。

## 运行时配置
- `FRONTEND_ORIGINS`: 允许访问 Gateway 的前端 Origin，多个值使用英文逗号分隔，例如 `https://app.example,https://admin.example`。不允许使用 `*`；未配置或包含无效值时对应 Origin 默认拒绝。
- `V2BOARD_BASE_URL`: V2Board API v1 基础地址，必须使用 HTTPS，例如 `https://backend.example/api/v1/`；末尾缺少 `/` 时客户端会自动补齐。
- `V2BOARD_SUBSCRIBE_PATH`: V2Board 上固定的 subscription route，例如 `/client/subscribe`。必须是根相对路径；不能包含 origin、query、fragment、反斜线、percent encoding 或 traversal。

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
