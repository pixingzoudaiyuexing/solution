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
│ ├─ 速率限制                        │
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
- **认证边界**: Gateway 原样传递 `auth_data`，由 V2Board 完成 Token 验证，不自建 Session。
- **Origin 暴露**: V2Board 保持公网可达（满足 Admin / Node / Payment Provider 直连需求）。Gateway 仅通过 DTO 层提供 API 抽象与后端隐藏，不实施强制网络隔离（Mandatory Access Control）。
- **Callback 路由**: 支付回调直接进入 V2Board 域名，不经过 Gateway。
