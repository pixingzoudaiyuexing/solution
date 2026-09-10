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
当前仓库只包含 Phase 1 网关与安全策略骨架。`API-CONTRACT.md` 中的业务路由是后续实现目标，当前不会返回伪造业务数据。

## 运行时配置
- `FRONTEND_ORIGINS`: 允许访问 Gateway 的前端 Origin，多个值使用英文逗号分隔，例如 `https://app.example,https://admin.example`。不允许使用 `*`；未配置或包含无效值时对应 Origin 默认拒绝。

## 目录结构规划
- `src/`: 源代码
  - `contract/`: 公网 API 协议定义
  - `routes/`: 公网 API 路由处理
  - `adapters/v2board/`: 专门与 V2Board 交互的防腐层
  - `http/`: CORS, Header 和 Request/Response 工具
  - `security/`: 安全与限速
- `test/`: 单元与集成测试
- `docs/`: 架构与设计文档
