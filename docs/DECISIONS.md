# Architecture Decisions

| ID    | 状态      | 决策内容 |
|-------|---------|--------------------------------------------------------------------------------|
| D-001 | APPROVED | 单 Cloudflare Worker，Gateway + Adapter 仅做模块分层，不拆服务。 |
| D-002 | APPROVED | Public API 采用稳定 `/api/v1` resource contract，禁止 transparent proxy。 |
| D-003 | APPROVED | V2Board `auth_data` 作为 opaque credential，公网使用 Bearer 表达，Gateway 不创建第二套 Session。 |
| D-004 | APPROVED | 浏览器 payment 走 Gateway；Payment Provider callback 单独进入 V2Board，并采用 Tunnel path isolation + WAF 双层隔离。 |
| D-005 | APPROVED | Access/subscription body 不转换协议，由 Worker stream verbatim。 |
| D-006 | APPROVED | Origin Protection 首选：Cloudflare Tunnel + Access Service Auth。 |
| D-007 | APPROVED | 删除 legacy AES / SEC_PASSWORD / SHA1 pathname mapping / x-salt。 |
| D-008 | APPROVED | Worker Rate Limiting 只用于 abuse protection，业务状态继续由 V2Board 负责。 |
| D-009 | APPROVED | 所有 V2Board Adapter fetch requests MUST use `redirect: "manual"`。对 3xx responses 由 Adapter 显式处理，严禁盲目跟随或透传。 |
| D-010 | APPROVED | Payment v1 由 V2Board 持有支付和订单状态；Gateway 只做 Contract 转换、安全过滤和 DTO 映射。 |

## D-010 Payment v1 实施约束

- V2Board 继续作为 payment/order state 的唯一 owner；Gateway 不保存支付、二维码或订单业务状态。
- Desktop QR 是 v1 首选支付体验，Client Application 通过 Order Detail 查询最终状态。
- Payment Provider callback 直接进入 V2Board，solution 不提供 callback proxy 或 webhook。
- Checkout 仅转发经过 `FRONTEND_ORIGINS` 精确校验的 HTTPS Origin，用于保留原生移动端 return 行为；不转发浏览器控制的 Host 和 Forwarded Host/Proto headers。
- 支付过期遵循 V2Board 订单过期规则，Gateway 不创建独立 timer。兼容上游现已提供权威 `expires_at`；Gateway 仅验证并映射 `expiresAt`，并规范化 V2Board checkout 的过期错误，不自行计算或执行过期判断。
- Checkout v1 的 Public response types 仅为 `finished`、`qrcode` 和 `redirect`。
