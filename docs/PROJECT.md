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
当前仓库已实现 Phase 2D Subscription & Access Foundation：在现有认证、目录、订单和 checkout 能力上，增加已购订阅资格判断、solution-owned access URL 与原始 subscription body 安全流式转发。Gateway 保持无状态，V2Board 继续拥有 subscription token、实际可用性和协议生成；Payment Provider callback 仍直接进入 V2Board。refund、reconciliation 和前端集成不在当前实现范围。

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
  - `security/`: 安全与限速
- `test/`: 单元与集成测试
- `docs/`: 架构与设计文档
