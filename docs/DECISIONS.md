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
