# Project solution

## 概述
`solution` 是一个基于 Cloudflare Workers 构建的完全无状态的 V2Board API Gateway。
主要负责隔离公网流量与 V2Board 后端，提供稳定的 `v1` API Contract，保护真实后端，并重塑过时的遗留客户端中间件逻辑。

## 目标
- 提供稳定且解耦的 Public API Contract (`/api/v1`)。
- 完全隐藏 V2Board 真实的路径和 Origin。
- 剥离原有的业务层 AES 加密等遗留安全债。
- 通过 CF Tunnel + Access 严格保护真实后端入口。

## 当前实现状态
当前仓库已实现 Phase 2C.3 Order Domain Foundation：登录、当前用户身份查询、产品列表、公共资源状态，以及订单创建、列表和详情。Gateway 保持无状态，checkout、payment、callback 等后续业务路由仍未实现。

## 运行时配置
- `FRONTEND_ORIGINS`: 允许访问 Gateway 的前端 Origin，多个值使用英文逗号分隔，例如 `https://app.example,https://admin.example`。不允许使用 `*`；未配置或包含无效值时对应 Origin 默认拒绝。
- `V2BOARD_BASE_URL`: V2Board API v1 基础地址，必须使用 HTTPS，例如 `https://private.example/api/v1/`；末尾缺少 `/` 时客户端会自动补齐。
- `V2BOARD_ACCESS_CLIENT_ID`: 可选的 Cloudflare Access Service Token ID，必须与 Secret 成对配置。
- `V2BOARD_ACCESS_CLIENT_SECRET`: 可选的 Cloudflare Access Service Token Secret，只能通过 Worker secret 配置，禁止提交到 Git。

## 目录结构规划
- `src/`: 源代码
  - `contract/`: 公网 API 协议定义
  - `routes/`: 公网 API 路由处理
  - `adapters/v2board/`: 专门与 V2Board 交互的防腐层
  - `http/`: CORS, Header 和 Request/Response 工具
  - `security/`: 安全与限速
- `test/`: 单元与集成测试
- `docs/`: 架构与设计文档
