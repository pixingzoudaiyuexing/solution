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
         Private V2Board Origin
```

## 网络与安全模型
- **无状态**: 不使用 KV/D1/Durable Objects 存储业务数据。
- **认证边界**: Gateway 原样传递 `auth_data`，由 V2Board 完成 Token 验证，不自建 Session。
- **Origin 保护**: 采用 Cloudflare Tunnel + Access，限制网关直接访问 V2Board 隐藏源站。
- **Callback 隔离**: 支付回调使用独立的 `payment-callback.example` 域名，由 WAF 和 Tunnel 路径白名单实现双层过滤。
