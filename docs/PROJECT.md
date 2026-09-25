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

CF-03B Dynamic Custom Pages 保持 authenticated `/api/v1/custom-pages` path 与 `{id,title,url,mode}` DTO；SOL-REG-M02-01 已 `PASS / COMPLETE / CLOSED / RE-FROZEN`，其 code-level runtime authority 已迁移为 Reserved Knowledge Registry `custom-pages` snapshot，并在返回前通过 Official V2Board `user/info` 验证真实 session。Notice 不再作为 Custom Pages runtime fallback或 merge source，target URL 也不会被 fetch；ordinary Notice list/detail 仍保留 existing lowercase `aureole:*` filtering。A3 Runtime Settings read route 与 Custom Pages route共同使真实 source route tree 保持 48 个 `/api/v1` Public routes。legacy Notice rows不在本任务删除，Production cutover未执行。

Gateway 只转换 Contract、过滤字段、规范化错误并受控转发；V2Board 继续拥有验证码、注册规则、用户、订单、支付、subscription、ticket、notice、knowledge、traffic、invite、commission 和所有业务状态。Payment Provider callback 仍直接进入 V2Board。

A1 `SOL-REG-KERNEL-01` 增加 internal-only Control Plane 与 Registry validation primitives，不增加 Public API。Official Admin Knowledge 是 reserved Registry raw source；Solution 只通过 deployment-owned `V2BOARD_CONTROL_AUTH_DATA` 和 `V2BOARD_CONTROL_ADMIN_PREFIX` 执行 code-owned list/detail read。Registry Kernel 严格验证 identity/envelope/module schema、stable IDs/references、exposure、DTO allowlist与provider secrets，并保持 module-level fail closed。A1 不增加 KV/snapshot/scheduler，不让 Browser request触发 Admin fetch，也不修改 V2Board 或 Aureole。

A2 `SOL-REG-KERNEL-02` is `PASS / COMPLETE / CLOSED / RE-FROZEN`. The independently reviewed runtime/code anchor is `f07770167a823e95665600c59e9e6e4f6d5d4927`; the pre-reconciliation Repo HEAD after reviewed A2 merge is `472635dbedb8efb23cb070ad827db970ddabf56f`; Gemini Follow-Up Delta Review is `PASS / 0 BLOCKER / 0 HIGH`. A2 引入唯一 code-level logical binding `REGISTRY_KV`，只保存 derived/rebuildable safe snapshot、bounded freshness、redacted health 与 minimal alert/recovery metadata；不保存业务/用户权威、raw source 或 secret。Worker 增加 internal scheduled boundary，但没有 Public Registry/health/refresh route；A2 closure 时 Public route count 为 47。Production KV namespace/binding、Cron cadence、Control Plane secrets 与 live Admin runtime evidence 均不存在。

A3 `SOL-REG-KERNEL-03` is `PASS / COMPLETE / CLOSED / RE-FROZEN`. The independently reviewed runtime/code anchor is `fa5b7714c7ecd61b49a977729a7ec652fb8e61ab`; the final independently reviewed A3 main anchor is `1729943b57e71ad9726b03f47b7882180e51ce91`; Gemini post-code review is `PASS / 0 BLOCKER / 0 HIGH / 0 MEDIUM / 0 LOW`. A3 只注册 REG-M01 `runtime-settings`，以 code-owned 24-hour `STALE_TOLERANT` policy 从现有 `REGISTRY_KV` safe snapshot 读取，并通过 anonymous `GET /api/v1/config/runtime` 返回显式七字段 `string|null` DTO。该 route 不触发 Admin Knowledge、Control Plane、refresh、V2Board 或 external fetch；不可用状态返回 all-null 200 fallback。当前 Public route count 为 48；REG-M07 与其他 product modules 未实现，Production 未部署或 provision 新资源，A4 未开始且未授权。

SOL-REG-M02-01 is `PASS / COMPLETE / CLOSED / RE-FROZEN`; runtime/code anchor is `b01f7d1805ff35896968106899b92f29f86c91f7`, final independently reviewed feature/main anchor is `e5bbfc6e96c04609a6db565fcbe458392e5857b1`, and Gemini is `PASS / 0 BLOCKER / 0 HIGH / 0 MEDIUM / 0 LOW`. It registers only REG-M02 `custom-pages`, uses the existing `REGISTRY_KV` safe snapshot and code-owned 24-hour `STALE_TOLERANT` policy. `GET /api/v1/custom-pages` still requires Bearer, but `user/info` session validation is not purchase entitlement; a valid session receives empty-items success when Registry state is unavailable. Notice is not a runtime fallback or merge source, legacy Notice rows remain, and Production cutover was not performed. REG-M07 and other product modules remain unimplemented.

SOL-REG-M04-M06-01 is `PASS / COMPLETE / CLOSED / RE-FROZEN`. Initial implementation anchor is `96bfcb37ffa02589ee2566399a0f19816ac999b6`; security/final runtime fix anchor is `92a9a432b46707b011c3456018fc15d836277ab1`; final independently reviewed/current-main anchor is `c884a73d93e240e2dddc7ea9f4e8ab58dffb736b`; Gemini is `PASS / 0 BLOCKER / 0 HIGH / 0 MEDIUM / 0 LOW`. It adds REG-M04 `subscription-delivery`, authenticated delivery-options/access-link APIs and Registry-independent root bearer streaming. The current entitlement correction uses Official `user/info` and mirrors Official `UserService::isAvailable()` before issuing new credentials; it still proves Official normal token equality, keeps all CF-02 and legacy access routes, and preserves REG-M06 `info=hide` as header-only suppression. This correction remains pending independent review and Primary acceptance. `/api/v1` route count is 50; M05 and REG-M07 are not implemented, Aureole migration and CF-02 cleanup are not performed or authorized, V2Board is unchanged, and Production is not authorized or deployed.

REG-M03 Download Center 已 `PASS / COMPLETE / CLOSED / RE-FROZEN`。Reviewed implementation anchor 为 `d97da44248aa1abff979815cbc51e9158f276e46`，Gemini post-code review 为 `PASS / 0 BLOCKER / 0 HIGH / 0 MEDIUM / 0 LOW`，merge/main anchor 为 `24e58a907f9595edb1551976122e3c920b859a9e`；Production 仍未部署。它注册 strict public `download-center` Registry module，以 module-level exactly-two `github-url-prefix` providers 生成 public `downloads[]`，不公开 standalone original GitHub URL。Scheduled 通过固定 GitHub Releases adapter解析 due items，并在单次 run 内按 normalized repository 去重；normalized、可重建的 schema-v2 派生 LKG 写入同一个 `REGISTRY_KV` key `registry:download-center:resolved:v1`。Anonymous `GET /api/v1/downloads` 只读派生 LKG，不触发 Admin Knowledge、GitHub、V2Board 或 provider fetch。Windows/Mac/Android 与多个 Linux variants由 Registry配置，Aureole负责将 Linux items分组为 `Linux GUI`；iOS不属于当前 Public Contract。当前 source route count 为 52；V2Board source/schema/business authority、Aureole consumer 和 Production 均未改变。

M03 authenticated repair anchor `9b1dcbbe5c470feb03c1313f8c77fec15e4d79ce` 已通过 Gemini `PASS / 0 BLOCKER / 0 HIGH / 0 MEDIUM / 0 LOW / 0 NEEDS_EVIDENCE`，fast-forward 合入 main并部署到 TEST Worker version `8668cfea-aa28-421a-935c-48775c8f0aa1`，Production 未部署。两阶段根因均已确认：receiver misuse 导致原始 pre-I/O `FETCH_REJECTED / Illegal invocation`；修复后 TEST-equivalent Smart Placement 探针确认共享出口的未认证 GitHub core quota 为 `60/remaining 0`。最终实现保留 receiver-safe wrapper并增加 optional deployment-owned `GITHUB_API_TOKEN`，严格限制为 1..512 visible ASCII且只用于固定 GitHub request；token 不进入 Registry/KV/Public DTO/log/error。真实 `2026-09-25T13:20:29.453Z` Cron 对三个 repositories 全部成功，elapsed 为 413/310/330 ms，七项全部 fresh、fallback 为 0；最终 `/api/v1/downloads` 为 HTTP 200/no-store、七项、每项两个有序 providers且无 auth/diagnostic/internal leakage。REG-M03 Solution TEST runtime 已 `PASS / COMPLETE / CLOSED / RE-FROZEN`；这不表示所有 GitHub rate limit 都被消除。

V2Board-first Business Ownership：官方 V2Board 已支持的业务规则、金额计算、资格、transaction、state mutation 和 callback 继续由 V2Board 持有；solution 只做 Public Contract、验证、安全过滤和 Adapter 映射。Coupon Application 只把 `promotionCode` 映射为 `coupon_code`，不预查、不计算折扣/价格/VIP/余额，也不保存 coupon state。

Phase 2V 的 Product Detail 只将 `GET /api/v1/products/{id}` 映射为一次 `GET user/plan/fetch?id={id}`。hidden/current/renewable Plan 的可见性和最终购买资格仍完全由 V2Board 决定；Gateway 不预读用户或套餐、不计算容量、不比较 current plan，也不复制 `show` / `renew` 逻辑。详情成功不代表 Order Create 成功，`user/order/save` 仍是最终权威。

Phase 2W 为 onboarding requirements、current preferences 和 currency 提供三个彼此独立的最小白名单 DTO。每个 route 只请求一个 Official endpoint；Gateway 不推断 registration availability、不聚合 mega-config、不暴露 app URL/Stripe/Telegram/withdrawal/multi-level commission 配置，也不缓存 config 或 preference state。针对当前 pinned Official V2Board `99f8526eddb72a4e8f6cbccd58cc0656bb91fe88`，anti-bot capability discovery 在 enabled 时稳定返回 `provider="recaptcha"` 与 `mode="v2-checkbox"`；该 classification 来自 Official default frontend 的 visible checkbox / explicit-render acquisition model，不增加其他 provider/mode。Auth mutation 契约仍保持 provider-neutral `challengeToken`，Adapter 映射到 `recaptcha_data`，V2Board 继续执行权威验证，Gateway 不持有 anti-bot state。

Wallet Balance Read 只把官方 `user/info.balance` 原样映射为 `balanceMinor`。Wallet Deposit 仅映射 V2Board 原生 `plan_id=0/period=deposit` Order Create；Gateway 不计算、合并、缓存或修改余额，不计算 bonus，也不持有 checkout、callback 或支付状态。Deposit、commission transfer、Gift Card、订单抵扣和 cancellation/refund 继续由 V2Board 持有。

普通 User Knowledge / Help Center Public API 与 Telegram Registry Ops 当前均未实现，但不是永久项目禁止项。普通 Knowledge 的已冻结未来方向为 ordinary V2Board Knowledge -> Solution safe adapter -> Aureole native Help Center；Reserved Admin Knowledge 只用于 internal Registry raw source，ordinary Knowledge 不得因正文类似 Registry JSON 而成为 Registry，reserved records 也不得泄露到 Help Center。Telegram 的已冻结未来方向为 owner-only、read-only Registry health / check / alert surface；当前没有 bot、scheduler、alerts 或 Telegram runtime。Multi-level commission distribution 仍是明确业务 Non-goal，部署必须保持 `commission_distribution_enable=0`。Commission Transfer 与 Withdrawal Request 都只映射官方 API；余额、资格、minimum、事务和 Ticket 创建由 V2Board 拥有。Subscription Rotation 的 token/UUID 与 Advance Period 的流量/有效期 mutation同样由 V2Board 生成、计算和保存；Gateway 不 pre-check、不计算周期、不 retry、不保存 mutation state。Gift Card 管理/创建/list/preview、Active Session、Quick Login、automatic payout、withdrawal admin，以及直接暴露 upstream `newPeriod` / `resetSecurity` 命名不属于 v1 Public Contract。

CF-02 Multiple Subscription Entries 当前仍依赖既有 CC V2Board compatibility endpoints。这是 transitional compatibility dependency，不是永久架构原则：所有新 CC 开发遵循 V2Board Zero-Patch；最终方向为 Reserved Knowledge Registry configuration + Solution runtime + Official V2Board token / entitlement / content authority。当前 CF-02 保留至 verified replacement 与 explicit cleanup authorization；未来升级不得默认 reapply CF-02 patches，且 Payment / Order hardening 独立于其 cleanup。

## 运行时配置
- Public API CORS 固定使用 `Access-Control-Allow-Origin: *`，不输出 `Access-Control-Allow-Credentials`。Frontend domain 是可替换的 browser client location，不是 authentication / authorization identity；更换域名不要求修改 solution 配置或重新部署 solution。
- 历史 Cloudflare bindings `FRONTEND_ORIGINS` 与 `FRONTEND_ORIGINS_EXTRA` 可暂时继续存在，但 application runtime 不再读取。它们属于 dormant bindings；后续 Runtime Config Hygiene 可在独立、可审计任务中安全清理，本任务不读取、替换或删除其值。
- `V2BOARD_BASE_URL`: V2Board API v1 基础地址，必须使用 HTTPS，例如 `https://backend.example/api/v1/`；末尾缺少 `/` 时客户端会自动补齐。
- `V2BOARD_SUBSCRIBE_PATH`: V2Board 上固定的 subscription route，例如 `/client/subscribe`。必须是根相对路径；不能包含 origin、query、fragment、反斜线、percent encoding 或 traversal。
- `V2BOARD_CONTROL_AUTH_DATA`: internal Control Plane bootstrap credential；必须以 Solution deployment secret人工 provision。Solution 不保存 Admin password、不自动登录，也不允许 Registry选择此 credential。
- `V2BOARD_CONTROL_ADMIN_PREFIX`: internal deployment-owned V2Board Admin secure prefix；必须使用安全 relative prefix，不能包含 origin、leading slash、backslash、query、fragment、percent encoding 或 traversal。Browser/Public input永远不能选择该值。
- `REGISTRY_KV`: A2 code-level logical Cloudflare KV binding；仅用于可重建的 Registry operational state。当前 `wrangler.jsonc` 没有 Production namespace ID、binding 或 Cron Trigger，实际 provision/activation 需要后续独立部署授权。

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
