# API Contract v1

公网暴露在 `/api/v1/...`，完全与后端 V2Board 路径解耦。

## 核心 API 矩阵 v0.1

| Public Contract                        | Auth           | V2Board Adapter Target          |
| -------------------------------------- | -------------- | ------------------------------- |
| `POST /api/v1/auth/login`              | No             | `passport/auth/login`           |
| `POST /api/v1/auth/register`           | No             | `passport/auth/register`        |
| `POST /api/v1/auth/email-code`         | No             | `passport/comm/sendEmailVerify` |
| `POST /api/v1/auth/password/reset`     | No             | `passport/auth/forget`          |
| `GET /api/v1/me`                       | Yes            | `user/info`                     |
| `POST /api/v1/me/password`             | Yes            | `user/changePassword`           |
| `PATCH /api/v1/me/preferences`         | Yes            | `user/update`                   |
| `GET /api/v1/me/stats`                 | Yes            | `user/getStat`                  |
| `GET /api/v1/products`                 | Yes            | `user/plan/fetch`               |
| `GET /api/v1/orders`                   | Yes            | `user/order/fetch`              |
| `POST /api/v1/orders`                  | Yes            | `user/order/save`               |
| `GET /api/v1/orders/{id}`              | Yes            | `user/order/detail`             |
| `GET /api/v1/orders/{id}/status`       | Yes            | `user/order/check`              |
| `POST /api/v1/orders/{id}/checkout`    | Yes            | `user/order/checkout`           |
| `POST /api/v1/orders/{id}/cancel`      | Yes            | `user/order/cancel`             |
| `GET /api/v1/billing/methods`          | Yes            | `user/order/getPaymentMethod`   |
| `POST /api/v1/promotions/validate`     | Yes            | `user/coupon/check`             |
| `GET /api/v1/access`                   | Yes            | `user/getSubscribe`             |
| `GET /api/v1/subscription`             | Yes            | `user/order/fetch` + `user/getSubscribe` |
| `GET /api/v1/access/subscription`      | URL credential | configured subscription route   |
| `GET /api/v1/resources`                | Yes            | `user/server/fetch`             |
| `GET /r/v1/{credential}`               | URL credential | client subscribe                |

## Phase 2A 已实现契约

### Login

```http
POST /api/v1/auth/login
Content-Type: application/json
```

Request：

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

`email` 必填且必须是有效邮箱格式；`password` 必填，长度为 8 至 1024 个字符。

Success：

```json
{
  "ok": true,
  "data": {
    "accessToken": "opaque-token",
    "tokenType": "Bearer"
  },
  "requestId": "request-id"
}
```

`accessToken` 来自 V2Board `auth_data`。Gateway 将其视为 opaque credential，不解析、不验证、不存储。

### Current User

```http
GET /api/v1/me
Authorization: Bearer <opaque-token>
```

Success：

```json
{
  "ok": true,
  "data": {
    "email": "user@example.com",
    "expiresAt": "2030-01-01T00:00:00.000Z",
    "status": "active"
  },
  "requestId": "request-id"
}
```

Gateway 只返回上述 Public DTO，不透传 V2Board user object。

`expiresAt` 为 ISO 8601 时间或 `null`；`status` 为 `active`、`expired`、`disabled` 之一。V2Board UUID、余额、套餐 ID 等字段不属于此 Public DTO。

### Authentication Errors

| HTTP | Code               | Message                | 场景 |
| ---- | ------------------ | ---------------------- | ---- |
| 400  | `VALIDATION_ERROR` | `Invalid request`      | Public payload 或 upstream validation 无效 |
| 401  | `AUTH_REQUIRED`    | `Authentication required` | 缺少或无法识别 Bearer credential |
| 401  | `AUTH_FAILED`      | `Authentication failed` | 凭据错误、账号禁用或 V2Board session 失效 |
| 502  | `UPSTREAM_ERROR`   | 固定公共错误信息       | 上游 HTML、无效 JSON 或未知故障 |
| 504  | `UPSTREAM_TIMEOUT` | `The upstream service timed out` | 上游请求超时 |

## Phase 2B 已实现契约

所有 Phase 2B 接口都要求：

```http
Authorization: Bearer <opaque-token>
```

### Products

```http
GET /api/v1/products
```

Success：

```json
{
  "ok": true,
  "data": {
    "products": [
      {
        "id": "7",
        "name": "Pro Plan",
        "dataAllowanceGb": 100,
        "speedLimitMbps": null,
        "available": true,
        "prices": [
          {
            "billingPeriod": "month",
            "amountMinor": 990
          }
        ]
      }
    ]
  },
  "requestId": "request-id"
}
```

`amountMinor` 使用 V2Board 配置货币的最小单位。`billingPeriod` 可为 `month`、`quarter`、`halfYear`、`year`、`twoYears`、`threeYears`、`oneTime`。流量重置价格不属于本接口。

### Public Resources

```http
GET /api/v1/resources
```

Success：

```json
{
  "ok": true,
  "data": {
    "resources": [
      {
        "id": "3",
        "name": "Hong Kong 01",
        "category": "vmess",
        "status": "online"
      }
    ]
  },
  "requestId": "request-id"
}
```

`status` 为 `online` 或 `offline`。Gateway 不返回节点 host、port、server key、协议配置或其他 V2Board 原始字段。

### Upstream Timeout

所有 V2Board outbound request 默认在 10 秒后由 AbortController 中止：

```json
{
  "ok": false,
  "error": {
    "code": "UPSTREAM_TIMEOUT",
    "message": "The upstream service timed out",
    "requestId": "request-id"
  }
}
```

HTTP status 为 `504`。

## Phase 2C.3 已实现契约

### Orders

```http
GET /api/v1/orders
Authorization: Bearer <opaque-token>
```

Success：

```json
{
  "ok": true,
  "data": [
    {
      "id": "order-001",
      "status": "pending",
      "amountMinor": 1099,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-02T00:00:00.000Z",
      "expiresAt": null
    }
  ],
  "requestId": "request-id"
}
```

`id` 来自 V2Board `trade_no`。`amountMinor` 直接使用 V2Board 的整数 `total_amount`，Gateway 不进行浮点金额运算。V2Board `order/fetch` 不返回明确 currency，因此币种仍属于待解决契约项。

`expiresAt` 为 ISO 8601 时间或 `null`。官方 V2Board `99f8526eddb72a4e8f6cbccd58cc0656bb91fe88` 的 User Order API 不返回权威 `expires_at`，因此 Gateway 返回 `null`，不会根据 `created_at` 或后台任务周期自行计算过期时间。未来兼容上游如果返回合法的整数 `expires_at`，Gateway 会将其转换为 ISO 8601；显式 `null` 或字段缺失都映射为 `null`，malformed 值仍按 `UPSTREAM_ERROR` fail closed。

状态映射：

| Public status | 含义 |
| ------------- | ---- |
| `pending`     | 待支付 |
| `processing`  | 已支付，开通处理中 |
| `cancelled`   | 已取消 |
| `completed`   | 已完成 |
| `adjusted`    | 已用于套餐变更折抵 |

Gateway 不返回 plan、payment、callback、commission、用户 UUID 或其他 V2Board Order 原始字段。

### Create Order

```http
POST /api/v1/orders
Authorization: Bearer <opaque-token>
Content-Type: application/json
```

Request：

```json
{
  "productId": "7",
  "billingPeriod": "month"
}
```

`productId` 是 Products API 返回的字符串 ID。`billingPeriod` 可为 `month`、`quarter`、`halfYear`、`year`、`twoYears`、`threeYears`、`oneTime`；不支持流量重置。

Success（HTTP 201）：

```json
{
  "ok": true,
  "data": {
    "id": "order-002"
  },
  "requestId": "request-id"
}
```

V2Board 创建接口只返回订单号，因此 Gateway 不伪造金额、状态或时间。完整订单由 Detail API 从 V2Board 重新读取。

Gateway 不接收价格、支付方式、优惠券、余额或其他 V2Board 参数，不负责价格计算、套餐有效性、购买资格或订单状态修改。V2Board 标准 `order/save` 可能按其自身业务规则自动使用用户已有余额；Gateway 不参与该计算，也不保存相关状态。

创建请求如果返回 `UPSTREAM_TIMEOUT`，订单可能已经由 V2Board 创建。Gateway 不自动重试，Client Application 应先重新查询 Orders List，避免重复提交。

### Order Detail

```http
GET /api/v1/orders/{id}
Authorization: Bearer <opaque-token>
```

Success 使用与 Orders List 相同的单个 Order DTO：

```json
{
  "ok": true,
  "data": {
    "id": "order-002",
    "status": "pending",
    "amountMinor": 1099,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": null,
    "expiresAt": null
  },
  "requestId": "request-id"
}
```

Payment Provider callback 和 refund 路由仍未实现。Promotion validation 与 subscription 使用各自独立 Public Contract；Order Create 本阶段不接受 `couponCode`。

错误：

| HTTP | Code                 | 场景 |
| ---- | -------------------- | ---- |
| 401  | `AUTH_REQUIRED`      | 缺少或无法识别 Bearer credential |
| 401  | `AUTH_FAILED`        | V2Board 拒绝当前 credential |
| 404  | `ORDER_NOT_FOUND`    | 当前用户的订单不存在 |
| 502  | `ORDER_CREATE_FAILED` | V2Board 拒绝创建订单 |
| 502  | `ORDER_QUERY_FAILED` | V2Board 返回可识别的订单查询错误 |
| 502  | `UPSTREAM_ERROR`     | HTML、无效 JSON 或 malformed order response |
| 504  | `UPSTREAM_TIMEOUT`   | V2Board 请求超时 |

## Phase 2C.4 已实现契约

以下接口均要求：

```http
Authorization: Bearer <opaque-token>
```

### Payment Methods

```http
GET /api/v1/billing/methods
```

Success：

```json
{
  "ok": true,
  "data": [
    {
      "id": "3",
      "name": "支付宝",
      "icon": "https://cdn.example/alipay.png",
      "fee": {
        "fixedMinor": 25,
        "percent": 0.5
      }
    }
  ],
  "requestId": "request-id"
}
```

`id` 是公开合同中的 opaque string，用于后续 checkout；Client Application 不需要理解其 V2Board 内部类型。Gateway 只返回可用渠道，并剥离 plugin class、UUID、notify domain、merchant 配置和其他 V2Board Payment 字段。不安全的 icon URL 返回 `null`。

### Checkout

```http
POST /api/v1/orders/{id}/checkout
Content-Type: application/json
```

Request：

```json
{
  "paymentMethodId": "3"
}
```

`paymentMethodId` 必须来自 Payment Methods API。请求不接受 provider token、return URL、merchant 参数或其他额外字段。

Success 根据 V2Board 当前支付动作返回以下三种 Public DTO 之一：

```json
{
  "ok": true,
  "data": {
    "type": "finished"
  },
  "requestId": "request-id"
}
```

```json
{
  "ok": true,
  "data": {
    "type": "qrcode",
    "data": "opaque QR payload"
  },
  "requestId": "request-id"
}
```

```json
{
  "ok": true,
  "data": {
    "type": "redirect",
    "target": "https://pay.example/checkout"
  },
  "requestId": "request-id"
}
```

映射规则：

| V2Board type | Public type | 约束 |
| ------------ | ----------- | ---- |
| `-1` | `finished` | 仅接受 V2Board 明确返回 `data=true`；订单 paid 处理仍由 V2Board 完成 |
| `0` | `qrcode` | `data` 是 1 至 4096 字符的 opaque QR 内容，可以是 HTTPS URL、支付 URI 或其他 provider QR 内容，但不得包含控制字符 |
| `1` | `redirect` | `target` 必须是无 userinfo 的公共 HTTPS URL，拒绝 localhost、私有/特殊用途 IP 和隐藏 V2Board host |
| `2` | `finished` | 仅接受 V2Board 明确返回 `data=true` |

未知 type、malformed payload 或不安全 redirect target 均 fail closed 为 `PAYMENT_CREATE_FAILED`。v1 不提供推测性的 `form` 类型，也不放行未经固定 fork 源码证明的自定义 redirect scheme。

Checkout 仅在请求 `Origin` 与 `FRONTEND_ORIGINS` 精确匹配且使用 HTTPS 时转发该 Origin，以保留 V2Board 原生移动端 return 行为。Gateway 不转发浏览器提供的 `Host`、`X-Forwarded-Host`、`X-Original-Host` 或 `X-Forwarded-Proto`。桌面 QR 流程不依赖浏览器 return navigation。

固定 V2Board 的 `EPayQrcode` 依赖请求 `User-Agent` 区分 Desktop 与 Mobile：Desktop 返回 `type=0` QR 内容，Mobile 返回 `type=1` 打开目标。为保留该行为，solution 仅在 checkout 请求中转发经过校验的原始 `User-Agent`；必须是 Fetch Header 可表示的 ByteString、长度为 1 至 512 UTF-8 bytes，且不得包含 C0、C1 或 DEL 控制字符。缺失 `User-Agent` 时不向上游添加该 header，V2Board 按 Desktop 处理。普通 Header allowlist 不包含 `User-Agent`，其他 Gateway API 不转发它。

Mobile `type=1` 仍使用现有 redirect 安全策略：仅允许公共 HTTPS target。固定源码证明 provider 可能返回自定义 App scheme，但尚无真实 Provider 返回值可建立精确 allowlist，因此当前状态为：

```text
NEEDS_PROVIDER_RUNTIME_EVIDENCE
```

本合同不声称移动 custom scheme 已通过真实 Provider 验证，也不会为兼容性放宽为任意 scheme。

Payment Provider callback 直接进入 V2Board。Gateway 不提供 callback/webhook 路由，不验证 provider 签名，不修改订单状态，也不保存 payment session 或 QR 状态。Client Application 使用已有 Order Detail API 查询最终订单状态。

支付协议要求 Provider 收到 V2Board `notify_url`。因此 V2Board 配置的 callback hostname 可能作为签名参数出现在支付跳转 URL 中；它不属于普通 Public API DTO 泄露，solution 不删除、替换或重写该参数，否则会破坏签名和 Provider callback。Consumer 仍不依赖 V2Board 的普通 API path、内部 DTO/model 或原始错误。

### Order Expiration Compatibility

当前兼容目标是官方 `wyx2685/v2board` `99f8526eddb72a4e8f6cbccd58cc0656bb91fe88`（`1.7.5.2685.2333`）。该版本通过 V2Board 自己的后台订单任务处理过期状态，但 User Order list/detail 不公开权威 expiry，checkout 也不保证同步返回独立的过期错误。

因此官方基线下 `expiresAt` 为 `null`。Gateway 不保存或推导 expiry，不根据本地时钟或 `created_at` 拒绝 checkout；Client Application 应通过 Order Detail 重新读取 V2Board 持有的订单状态。未来兼容上游提供合法 `expires_at` 时，Gateway 可直接映射该权威值，不需要改变 Public DTO。

Gateway 保留对精确 `Order has expired` 上游错误的兼容映射，但官方基线不承诺产生该错误，Client Application 不得依赖 `ORDER_EXPIRED` 必然出现。其他包含 `expired` 字样的未知上游错误不会被宽泛归类。

### Payment Errors

| HTTP | Code                         | 场景 |
| ---- | ---------------------------- | ---- |
| 400  | `VALIDATION_ERROR`           | order ID、JSON body、payment method ID 或 checkout User-Agent 无效 |
| 401  | `AUTH_REQUIRED`              | 缺少或无法识别 Bearer credential |
| 401  | `AUTH_FAILED`                | V2Board 拒绝当前 credential |
| 409  | `ORDER_EXPIRED`              | 仅当兼容上游明确返回精确订单过期错误；官方 `99f8526` 不保证产生 |
| 422  | `PAYMENT_METHOD_UNAVAILABLE` | V2Board 明确确认支付渠道不可用 |
| 502  | `PAYMENT_CREATE_FAILED`      | V2Board 可识别的支付创建失败、未知 type 或不安全/malformed 支付动作 |
| 502  | `UPSTREAM_ERROR`             | HTML、无效 JSON 或无法安全分类的上游故障 |
| 504  | `UPSTREAM_TIMEOUT`           | V2Board 请求超时；Gateway 不自动重试 checkout |

## 错误响应规范
统一错误响应格式：
```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误信息",
    "requestId": "..."
  }
}
```
未知的 HTML 或 500 必须映射为 `502 UPSTREAM_ERROR`。

## Phase 2D 已实现契约

### Subscription Metadata

```http
GET /api/v1/subscription
Authorization: Bearer <opaque-token>
```

从未成功购买订阅、只有 pending/cancelled 订单、或只有 `plan_id=0` 充值订单时：

```json
{
  "ok": true,
  "data": {
    "eligible": false,
    "accessUrl": null
  },
  "requestId": "request-id"
}
```

Gateway 此时不会调用 V2Board `user/getSubscribe`，避免无资格用户触发 subscription credential 生成。

V2Board 订单历史中存在 `plan_id>0` 且状态为 paid/processing、completed 或 adjusted 的订阅订单时，用户属于 previous purchaser：

```json
{
  "ok": true,
  "data": {
    "eligible": true,
    "accessUrl": "https://gateway.example/api/v1/access/subscription?token=opaque-token"
  },
  "requestId": "request-id"
}
```

`accessUrl` 使用经过校验的当前 solution Gateway HTTPS origin 构建，不使用 upstream origin、`Host` 或 `X-Forwarded-*`。Gateway 从 V2Board `subscribe_url` 中严格提取 V2Board 生成的 token，但不返回 raw upstream URL、raw user token、UUID 或订单内部字段。previous purchaser 即使当前订阅已过期仍可得到 access URL；实际 subscription 是否可用继续由 V2Board 决定。

### Subscription Access

```http
GET /api/v1/access/subscription?token=<opaque-token>
```

该 endpoint 不使用浏览器 Bearer Header；query token 本身是敏感 subscription bearer credential。token 必须是 1 至 512 字符的 URL-safe `A-Z a-z 0-9 _ -` 字符串，支持兼容 V2Board 的 normal、OTP 和 time-based token。Gateway 不保存、哈希、轮换或重新签发 token。

V2Board subscription path 由部署配置 `V2BOARD_SUBSCRIBE_PATH` 固定提供。它必须是单一根相对路径，不能来自请求，也不能包含 scheme、authority、query、fragment、反斜线、percent encoding 或 traversal。subscription 请求仍通过 `V2BoardClient`，继续使用 10 秒 timeout 和 `redirect: manual`；当前冻结部署不使用 Cloudflare Access Service Token。

Gateway 将经过现有安全校验的 subscription client `User-Agent` 单独转发给 V2Board，用于 Clash/Mihomo、Shadowrocket、Sing-box 等协议选择；普通 header allowlist 不放宽。本版本不公开可选 `flag` 参数。

成功响应直接从 upstream `Response.body` 流向 Client，不读取或转换 body；Clash YAML、通用 base64、Sing-box JSON 和成功空响应均保持原始 bytes。只允许以下 upstream response headers：

```text
Content-Type
Content-Disposition
subscription-userinfo
profile-update-interval
profile-title
```

`Set-Cookie`、`Server`、`X-Powered-By`、`Location`、`profile-web-page-url`、Cloudflare/internal headers 均不转发。所有 access responses 使用 `Cache-Control: no-store`。

无效请求、无效/过期 token、不可用订阅及 upstream 故障统一返回纯文本：

```text
subscription_unavailable
```

公共状态分别为 `400`（请求无效）、`404`（V2Board 4xx unavailable）、`502`（redirect/5xx/配置或未知故障）、`504`（timeout）。不会透传 Laravel HTML、upstream body、Location 或 token 有效性细节。V2Board 对当前用户不可用时可能合法返回 HTTP 200 空 body，Gateway 保持该权威语义。

### Phase 2D Runtime Acceptance

目标环境使用官方 `wyx2685/v2board` `99f8526eddb72a4e8f6cbccd58cc0656bb91fe88`（`1.7.5.2685.2333`）。验收结论：

```text
PASS WITH NON-BLOCKING NOT-TESTED ITEMS
```

已通过：official V2Board runtime compatibility、模拟 payment callback、订单 `pending -> completed`、`callback_no` 记录、套餐激活、solution order 状态同步、subscription eligibility、solution-owned access URL、subscription verbatim streaming、direct/Gateway body bytes 与 SHA-256 parity、header filtering、`Cache-Control: no-store`、Clash wire format、Mihomo 实际配置校验、Shadowrocket wire format、Sing-box wire format。

仍未验证：Shadowrocket 真机导入、Sing-box 客户端导入、Clash Classic 原生客户端、真实支付。这些是 runtime gaps，不阻塞当前 Adapter contract。

## Phase 2E Account Lifecycle

以下接口均通过 `V2BoardClient` 调用官方 `wyx2685/v2board` `99f8526eddb72a4e8f6cbccd58cc0656bb91fe88`，使用 10 秒 timeout 和 `redirect: manual`。Gateway 不存储验证码、密码、注册状态或 session。

### Email Verification Code

```http
POST /api/v1/auth/email-code
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "purpose": "register",
  "challengeToken": "opaque-token"
}
```

`purpose` 只能为 `register` 或 `password-reset`，Adapter 分别映射为官方 V2Board 的 `isforget=0` 或 `isforget=1`。`challengeToken` 是可选、长度受限的 opaque string；当前 Adapter 将其映射为官方 V2Board 的 `recaptcha_data`。Public Contract 不暴露 `isforget` 或任何具体 anti-bot Provider 名称。

Success：

```json
{
  "ok": true,
  "data": { "sent": true },
  "requestId": "request-id"
}
```

V2Board 负责 IP 限流、邮箱白名单、Gmail alias 限制、邮箱存在性、发送冷却、reCAPTCHA、邮件派发和验证码存储。

### Register

```http
POST /api/v1/auth/register
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "password": "password123",
  "emailCode": "123456",
  "inviteCode": "ABCDEF",
  "challengeToken": "opaque-token"
}
```

`password` 长度为 8 至 64；`emailCode`、`inviteCode` 和 `challengeToken` 可选。Adapter 将它们映射为 `email_code`、`invite_code` 和官方当前使用的 `recaptcha_data`。`emailCode` 或 `challengeToken` 可选不代表上游不会要求验证；是否必需由 V2Board 当前配置和业务规则决定。

成功响应与 Login 使用相同的 opaque auth DTO：

```json
{
  "ok": true,
  "data": {
    "accessToken": "opaque-token",
    "tokenType": "Bearer"
  },
  "requestId": "request-id"
}
```

Gateway 不解析、验证或保存 `auth_data`，也不创建第二套 session。注册关闭、邀请码、邮箱验证、重复邮箱、试用套餐和注册限流均由 V2Board 处理。

### Password Reset

```http
POST /api/v1/auth/password/reset
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "emailCode": "123456",
  "newPassword": "new-password123"
}
```

`emailCode` 必须为 6 位数字；`newPassword` 长度为 8 至 64。Adapter 分别映射为 `email_code` 和 `password`。

Success：

```json
{
  "ok": true,
  "data": { "reset": true },
  "requestId": "request-id"
}
```

Gateway 不在 reset 后自动登录。验证码校验、尝试次数、用户存在性、密码更新、验证码失效和旧 session 失效全部由 V2Board 负责。

### Account Lifecycle Errors

| HTTP | Code | 场景 |
| ---- | ---- | ---- |
| 400 | `VALIDATION_ERROR` | Public payload 或 upstream validation 无效 |
| 409 | `REGISTRATION_UNAVAILABLE` | 官方 exact error 表明重复邮箱、注册关闭、邀请码或邮箱策略拒绝 |
| 422 | `VERIFICATION_FAILED` | 官方 exact error 表明邮箱验证码或 anti-bot challenge 校验失败 |
| 422 | `PASSWORD_RESET_FAILED` | 官方 exact error 表明目标用户不存在或密码重置失败 |
| 429 | `RATE_LIMITED` | V2Board HTTP 429 或官方 exact cooldown/attempt-limit error |
| 502 | `UPSTREAM_ERROR` | HTML、invalid JSON、未知或无法可靠分类的 upstream error |
| 504 | `UPSTREAM_TIMEOUT` | V2Board 请求超时 |

所有响应使用 `Cache-Control: no-store`。错误响应不会透传 V2Board/Laravel message；仅对官方源码确认的完整 exact message 做业务分类，不使用模糊 `includes` 匹配。

Account Lifecycle 的 anti-bot Public Contract 使用 provider-neutral `challengeToken`。Google reCAPTCHA 只是当前官方 V2Board 的 upstream implementation detail，不属于 solution Public API；当前映射为 `challengeToken -> recaptcha_data`。未来可以替换或引入其他 anti-bot Provider，而不改变 Account Lifecycle Public Contract。本 Phase 不实现 Provider selection、challenge endpoint、验证服务或 Gateway anti-bot state。

## Phase 2F Order Actions and Promotion Validation

以下接口均要求 `Authorization: Bearer <opaque-token>`。Gateway 不保存订单或优惠券状态，也不复制 V2Board 的取消和优惠券业务规则。

### Order Status

```http
GET /api/v1/orders/{id}/status
```

Adapter 调用 `GET user/order/check?trade_no=<id>`，将官方 numeric status 通过与 Order List/Detail 相同的映射转换为 Public `OrderStatus`：

```json
{
  "ok": true,
  "data": {
    "id": "order-001",
    "status": "pending"
  },
  "requestId": "request-id"
}
```

Gateway 不根据订单字段或本地时间推断 paid、pending、cancelled 或 expired，只转换 V2Board 当前返回值。

### Order Cancel

```http
POST /api/v1/orders/{id}/cancel
```

Public 请求不需要 body。Adapter 只向 `POST user/order/cancel` 发送：

```json
{ "trade_no": "order-001" }
```

Success：

```json
{
  "ok": true,
  "data": { "cancelled": true },
  "requestId": "request-id"
}
```

订单归属、存在性、是否 pending、余额/优惠券副作用和实际取消全部由 V2Board 负责。Gateway 不先查询状态，也不自行决定是否允许取消。

### Promotion Validation

```http
POST /api/v1/promotions/validate
Content-Type: application/json
```

```json
{
  "code": "PROMO123",
  "productId": 1
}
```

`code` 是长度 1 至 255 的字符串；`productId` 是正整数。Adapter 映射为官方 V2Board `POST user/coupon/check` 的 `code` 与 `plan_id`。

官方 `CouponService::getCoupon()` 返回完整 Coupon Model。Gateway 只解析折扣所需的 `type` 和 `value`，其他 id、code、name、使用次数、用户/套餐限制和时间字段全部丢弃。

固定金额优惠：

```json
{
  "ok": true,
  "data": {
    "valid": true,
    "discount": { "type": "fixed", "amountMinor": 500 }
  },
  "requestId": "request-id"
}
```

百分比优惠：

```json
{
  "ok": true,
  "data": {
    "valid": true,
    "discount": { "type": "percentage", "percent": 25 }
  },
  "requestId": "request-id"
}
```

V2Board 负责 coupon 是否存在、启用状态、有效期、次数、套餐/周期/用户限制和折扣规则。Validation 不创建 Gateway coupon token，也不修改 Order Create；购买时是否提交 coupon code 属于后续独立 contract。

### Phase 2F Errors

| HTTP | Code | 场景 |
| ---- | ---- | ---- |
| 400 | `VALIDATION_ERROR` | order ID、promotion code 或 productId 无效 |
| 401 | `AUTH_REQUIRED` | 缺少或无法识别 Bearer credential |
| 401 | `AUTH_FAILED` | V2Board 拒绝 credential |
| 404 | `ORDER_NOT_FOUND` | V2Board exact error 表明订单不存在 |
| 409 | `ORDER_NOT_CANCELLABLE` | V2Board exact error 表明订单不是 pending |
| 422 | `PROMOTION_INVALID` | V2Board exact error 表明 coupon 无效、不可用或不适用 |
| 502 | `ORDER_CANCEL_FAILED` | V2Board exact error 表明取消执行失败 |
| 502 | `UPSTREAM_ERROR` | malformed、HTML、未知或无法可靠分类的 upstream error |
| 504 | `UPSTREAM_TIMEOUT` | V2Board 请求超时 |

所有响应使用 `Cache-Control: no-store`。业务错误只按官方 `99f8526` 的完整 exact message 分类，不使用模糊字符串匹配，也不返回 raw V2Board/Laravel message。

## Phase 2G Account Self-Service

以下接口均要求 `Authorization: Bearer <opaque-token>`，继续使用统一 `V2BoardClient`、10 秒 timeout、`redirect: manual` 和 header allowlist。V2Board 持有密码、session、用户偏好和账户统计；Gateway 不保存这些状态。

现有 `GET /api/v1/me` Contract 保持不变，仍只返回 `email`、`expiresAt` 和 `status`。

### Change Password

```http
POST /api/v1/me/password
Content-Type: application/json
```

```json
{
  "currentPassword": "old-password",
  "newPassword": "new-password"
}
```

`currentPassword` 长度为 1 至 1024，`newPassword` 长度为 8 至 1024。Adapter 映射为官方 `POST user/changePassword` 的 `old_password` 和 `new_password`。

Success：

```json
{
  "ok": true,
  "data": { "changed": true },
  "requestId": "request-id"
}
```

成功后 V2Board 更新密码并调用 `removeAllSession()`，包括当前 Bearer 在内的旧 session 都由 V2Board 失效。Gateway 不创建新 token、不自动登录、不缓存旧 token，也不自行 revoke session。

### Preferences

```http
PATCH /api/v1/me/preferences
Content-Type: application/json
```

```json
{
  "autoRenewal": true,
  "remindExpire": true,
  "remindTraffic": false
}
```

三个字段均为 boolean 且可选，但请求至少必须提供一个。Adapter 映射为官方 `POST user/update` 的 `auto_renewal`、`remind_expire`、`remind_traffic`，boolean 分别转换为 `1/0`。未出现在 Public 请求中的字段不发送给 V2Board，因此不会被 Gateway 覆盖。

Success：

```json
{
  "ok": true,
  "data": { "updated": true },
  "requestId": "request-id"
}
```

### Account Stats

```http
GET /api/v1/me/stats
```

官方 `GET user/getStat` 返回 positional array：`[pendingOrderCount, openTicketCount, invitedUserCount]`。Gateway 要求恰好三个非负、受限整数并转换为命名 DTO：

```json
{
  "ok": true,
  "data": {
    "pendingOrders": 0,
    "openTickets": 0,
    "invitedUsers": 0
  },
  "requestId": "request-id"
}
```

Gateway 不自行查询订单、工单或邀请数据。数组长度错误、负数、浮点数、字符串或 malformed envelope 均 fail closed 为 `UPSTREAM_ERROR`。

### Phase 2G Errors

| HTTP | Code | 场景 |
| ---- | ---- | ---- |
| 400 | `VALIDATION_ERROR` | Public body 缺失、类型错误、越界、空 preferences 或额外字段 |
| 401 | `AUTH_REQUIRED` | 缺少或无法识别 Bearer credential |
| 401 | `AUTH_FAILED` | V2Board 拒绝 Bearer credential |
| 422 | `PASSWORD_CHANGE_FAILED` | V2Board exact error 表明旧密码错误、用户不存在或保存失败 |
| 502 | `PREFERENCES_UPDATE_FAILED` | V2Board exact error 表明偏好保存失败或用户不存在 |
| 502 | `UPSTREAM_ERROR` | malformed、HTML、未知或无法可靠分类的 upstream error |
| 504 | `UPSTREAM_TIMEOUT` | V2Board 请求超时 |

密码和 Bearer credential 不进入日志或响应。业务错误只按官方 `99f8526` 的完整 exact message 分类，不把 current password 错误误报为 `AUTH_FAILED`。
