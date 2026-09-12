# API Contract v1

公网暴露在 `/api/v1/...`，完全与后端 V2Board 路径解耦。

## v1 冻结 API 矩阵

| Public Contract                        | Auth           | V2Board Adapter Target          |
| -------------------------------------- | -------------- | ------------------------------- |
| `POST /api/v1/auth/login`              | No             | `passport/auth/login`           |
| `POST /api/v1/auth/register`           | No             | `passport/auth/register`        |
| `POST /api/v1/auth/email-code`         | No             | `passport/comm/sendEmailVerify` |
| `POST /api/v1/auth/password/reset`     | No             | `passport/auth/forget`          |
| `GET /api/v1/config/onboarding`        | No             | `guest/comm/config`             |
| `GET /api/v1/config/account`           | Yes            | `user/comm/config`              |
| `GET /api/v1/me`                       | Yes            | `user/info`                     |
| `POST /api/v1/me/password`             | Yes            | `user/changePassword`           |
| `GET /api/v1/me/preferences`           | Yes            | `user/info`                     |
| `PATCH /api/v1/me/preferences`         | Yes            | `user/update`                   |
| `GET /api/v1/me/stats`                 | Yes            | `user/getStat`                  |
| `GET /api/v1/wallet`                   | Yes            | `user/info`                     |
| `POST /api/v1/wallet/deposits`         | Yes            | `user/order/save`               |
| `GET /api/v1/products`                 | Yes            | `user/plan/fetch`               |
| `GET /api/v1/products/{id}`            | Yes            | `user/plan/fetch?id={id}`       |
| `GET /api/v1/orders`                   | Yes            | `user/order/fetch`              |
| `POST /api/v1/orders`                  | Yes            | `user/order/save`               |
| `GET /api/v1/orders/{id}`              | Yes            | `user/order/detail`             |
| `GET /api/v1/orders/{id}/status`       | Yes            | `user/order/check`              |
| `POST /api/v1/orders/{id}/checkout`    | Yes            | `user/order/checkout`           |
| `POST /api/v1/orders/{id}/cancel`      | Yes            | `user/order/cancel`             |
| `GET /api/v1/billing/methods`          | Yes            | `user/order/getPaymentMethod`   |
| `POST /api/v1/promotions/validate`     | Yes            | `user/coupon/check`             |
| `GET /api/v1/subscription`             | Yes            | `user/order/fetch` + `user/getSubscribe` |
| `GET /api/v1/subscription/overview`    | Yes            | `user/getSubscribe`              |
| `POST /api/v1/subscription/rotate-access` | Yes         | `user/order/fetch` + `GET user/resetSecurity` |
| `POST /api/v1/subscription/advance-period` | Yes        | `POST user/newPeriod`            |
| `GET /api/v1/access/subscription`      | URL credential | configured subscription route   |
| `GET /api/v1/resources`                | Yes            | `user/server/fetch`             |
| `GET /api/v1/tickets`                  | Yes            | `user/ticket/fetch`             |
| `GET /api/v1/tickets/{id}`             | Yes            | `user/ticket/fetch?id={id}`     |
| `POST /api/v1/tickets`                 | Yes            | `user/ticket/save`              |
| `POST /api/v1/tickets/{id}/reply`      | Yes            | `user/ticket/reply`             |
| `POST /api/v1/tickets/{id}/close`      | Yes            | `user/ticket/close`             |
| `GET /api/v1/notices`                  | Yes            | `user/notice/fetch`             |
| `GET /api/v1/notices/{id}`             | Yes            | `user/notice/fetch?id={id}`     |
| `GET /api/v1/traffic/logs`             | Yes            | `user/stat/getTrafficLog`       |
| `GET /api/v1/referrals`                | Yes            | `user/invite/fetch`             |
| `POST /api/v1/referrals/codes`         | Yes            | `GET user/invite/save`          |
| `GET /api/v1/referrals/commissions`    | Yes            | `user/invite/details`           |
| `POST /api/v1/referrals/commissions/transfer` | Yes     | `user/transfer`                 |
| `GET /api/v1/referrals/withdrawal-options` | Yes        | `user/comm/config`              |
| `POST /api/v1/referrals/withdrawal-requests` | Yes      | `user/ticket/withdraw`          |
| `POST /api/v1/gift-cards/redeem`       | Yes            | `user/redeemgiftcard`           |

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

`email` 必填、必须是有效邮箱格式且 trim 后长度不超过 254 个字符；`password` 必填，长度为 8 至 1024 个字符。请求 schema 为 strict，额外字段会被拒绝。

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

### Product Detail

```http
GET /api/v1/products/{id}
Authorization: Bearer <opaque-token>
```

`id` 使用与 Order Create `productId` 相同的规则：必须是 1 至 `2147483647` 的正整数字符串，不接受负数、0、小数、科学计数法或任意字符串。

Success：

```json
{
  "ok": true,
  "data": {
    "product": {
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
  },
  "requestId": "request-id"
}
```

Gateway 只执行一次 authenticated `GET user/plan/fetch?id={id}`，不预读 `user/info`、`user/getSubscribe`、plan list 或 order list。官方 V2Board 独占决定 Plan 是否存在、是否可见、hidden Plan 是否属于当前用户以及是否可续费。因此，官方允许当前用户读取的 hidden renewable Plan 会正常映射为同一 Product DTO；Gateway 不做额外可见性、renew 或 current-plan 比较。

Product Detail 与 Products List 复用同一 Plan-to-Product 映射。`available` 继续仅表示上游 `capacity_limit` 为 `null`/缺失或大于 0。官方 list endpoint 会用活跃用户数调整该字段，detail endpoint 则返回未调整的 Plan 字段；Gateway 不计算容量，也不伪造两个 endpoint 之间的一致性。

详情读取成功不代表后续 Order Create 一定成功；`POST /api/v1/orders` 及 V2Board `user/order/save` 仍是最终购买/续费资格的权威。Public DTO 不暴露 `show`、`renew`、`reset_price`、`capacity_limit`、`device_limit`、`content` 或 raw Plan model；返回 `Cache-Control: no-store`。

官方 exact error `Subscription plan does not exist` 及官方中文翻译 `订阅计划不存在` 统一映射为 `404 PRODUCT_NOT_FOUND`，不区分真实不存在、hidden 不可见或 renew 不允许。部分匹配、未知错误、malformed payload、HTML 或 invalid JSON 统一 fail closed 为 `502 UPSTREAM_ERROR`；timeout 为 `504 UPSTREAM_TIMEOUT`。

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
  "billingPeriod": "month",
  "promotionCode": "PROMO123"
}
```

`productId` 是 Products API 返回的字符串 ID。`billingPeriod` 可为 `month`、`quarter`、`halfYear`、`year`、`twoYears`、`threeYears`、`oneTime`；不支持流量重置。`promotionCode` 可选，trim 后长度为 1 至 255；Public Contract 不接受 `couponCode`、`coupon_code` 或其他别名。

未提供 promotion 时，Adapter 继续只发送：

```json
{ "plan_id": 7, "period": "month_price" }
```

提供 promotion 时，只在同一次 `POST user/order/save` 增加：

```json
{
  "plan_id": 7,
  "period": "month_price",
  "coupon_code": "PROMO123"
}
```

Gateway 不会先调用 `user/coupon/check`。Order Create 是最终权威：V2Board 在 transaction 内重新检查 coupon 存在性、状态、起止时间、全局和 per-user 次数、套餐及 billing period 限制，并负责 coupon usage、`coupon_id`、discount、VIP discount、套餐变更折抵、现有余额抵扣、最终金额和 Order 持久化。

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

Gateway 不接收价格、支付方式、余额或其他 V2Board 内部金额参数，只接受可选的 opaque `promotionCode`。Gateway 不计算、预测或返回 original/final price、discount、VIP discount、balance used 或 coupon usage，也不保存 coupon/order state。完整订单金额继续由 Detail API 从 V2Board 读取。

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

Payment Provider callback 仍直接进入 V2Board，solution 不提供 callback proxy；refund route 不在 Public Contract。Order Create 只接受 `promotionCode`，不接受 `couponCode` 或 upstream `coupon_code`。

错误：

| HTTP | Code                 | 场景 |
| ---- | -------------------- | ---- |
| 401  | `AUTH_REQUIRED`      | 缺少或无法识别 Bearer credential |
| 401  | `AUTH_FAILED`        | V2Board 拒绝当前 credential |
| 404  | `ORDER_NOT_FOUND`    | 当前用户的订单不存在 |
| 422  | `PROMOTION_INVALID` | 提供 promotionCode 且 V2Board 明确拒绝 coupon business rule |
| 502  | `ORDER_CREATE_FAILED` | V2Board 拒绝创建订单，包括 `Coupon failed` 操作故障 |
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

该 endpoint 不使用浏览器 Bearer Header；query token 本身是敏感 subscription bearer credential。token 必须是 1 至 512 字符的 URL-safe `A-Z a-z 0-9 _ -` 字符串，支持兼容 V2Board 的 normal、OTP 和 time-based token。Gateway 不保存、哈希或自行签发 token；Phase 2P 的显式 rotation 仍由 V2Board 生成并持久化新 credential。

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

V2Board 负责 coupon 是否存在、启用状态、有效期、次数、套餐/周期/用户限制和折扣规则。Validation 是下单前 preview，不创建 Gateway coupon token，也不会预留 coupon。由于官方 preview 不接收 billing period，validation success 不保证稍后的 Order Create 成功；`POST /api/v1/orders` 会将 `promotionCode` 映射为 `coupon_code`，由 `user/order/save` 在 transaction 中进行最终验证和应用。

静态 coupon rejection 使用与 Order Create 共享的官方 exact message classifier。唯一动态 per-user limit 只接受官方完整锚定格式，其中次数部分必须是 integer；不使用 `includes`、prefix 或宽泛 regex。`Coupon failed / 优惠券使用失败` 表示 coupon usage/save 操作故障，不归类为用户输入错误，在 Order Create 中保持 `502 ORDER_CREATE_FAILED`。

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

## Phase 2H Subscription Overview

```http
GET /api/v1/subscription/overview
Authorization: Bearer <opaque-token>
```

Adapter 只调用官方 `GET user/getSubscribe`。Overview 是当前套餐、流量、设备和续期配置的只读快照，不等价于 `GET /api/v1/subscription` 的历史购买 eligibility，也不改变 solution-owned access URL 或 subscription streaming逻辑。

有套餐用户：

```json
{
  "ok": true,
  "data": {
    "product": {
      "id": "7",
      "name": "Pro Plan"
    },
    "expiresAt": "2030-01-01T00:00:00.000Z",
    "traffic": {
      "uploadedBytes": 123,
      "downloadedBytes": 456,
      "allowanceBytes": 107374182400
    },
    "deviceLimit": 3,
    "activeDevices": 1,
    "resetDay": 15,
    "renewalAllowed": true
  },
  "requestId": "request-id"
}
```

无套餐用户的 `plan_id` 可以为 `null` 或 `0`，且 Public `product` 返回 `null`。这不是 eligibility 判断；Gateway 不自行推断用户是否可获得 subscription access。

字段映射：

| Official V2Board field | Public field | 类型与语义 |
| --- | --- | --- |
| `plan.id` / `plan.name` | `product.id` / `product.name` | 最小产品引用；ID 与 Products API 一样使用 string |
| `expired_at` | `expiresAt` | 合法 Unix timestamp 转 ISO 8601；`null` 保持 `null` |
| `u` | `traffic.uploadedBytes` | 非负 JavaScript safe integer bytes |
| `d` | `traffic.downloadedBytes` | 非负 JavaScript safe integer bytes |
| `transfer_enable` | `traffic.allowanceBytes` | 非负 JavaScript safe integer bytes |
| `device_limit` | `deviceLimit` | 非负整数或 `null`；不把 `0` 与 `null` 互换 |
| `alive_ip` | `activeDevices` | 非负整数；Gateway 不查询或缓存设备状态 |
| `reset_day` | `resetDay` | 非负整数或 `null`；Gateway 不自行计算 |
| `allow_new_period` | `renewalAllowed` | 严格接受官方 `0/1` 及配置序列化的 `"0"/"1"` 并转换 boolean |

`renewalAllowed` 只表示 V2Board `allow_new_period` 功能开关已开启，不保证当前用户此刻一定能 advance。实际资格还取决于流量是否耗尽、reset method/day/period、剩余有效期和其他 V2Board 状态，并由 `POST /api/v1/subscription/advance-period` 调用官方 `newPeriod` 时权威判断。Gateway 不提供 remaining bytes、used percent、over-quota、剩余天数、expired boolean或 grace period等派生字段。

Public response 不包含 V2Board `token`、`subscribe_url`、`uuid`、email、完整 plan、`group_id`、内部 user ID 或 server配置。上游缺少必填字段、plan 与 `plan_id` 不一致、负数/浮点/超出安全整数、malformed timestamp/plan/device/reset/renewal flag均 fail closed为 `502 UPSTREAM_ERROR`；认证和 timeout继续使用现有 `AUTH_FAILED` 与 `UPSTREAM_TIMEOUT`。

## Phase 2I Support Tickets

以下接口均要求 `Authorization: Bearer <opaque-token>`。Gateway 不保存工单状态、不判断用户能否创建/回复工单，也不复制 V2Board 的通知逻辑。所有工单记录、消息、状态、资格判断和通知副作用均由官方 V2Board `99f8526eddb72a4e8f6cbccd58cc0656bb91fe88` 持有。

固定枚举映射：

| Official V2Board | Public Contract |
| --- | --- |
| `status=0` | `open` |
| `status=1` | `closed` |
| `level=0` | `low` |
| `level=1` | `normal` |
| `level=2` | `high` |

Ticket ID 使用十进制正整数字符串，最大值为 `2147483647`。`subject` 长度为 1 至 255 个字符；create/reply 的 `message` 长度为 1 至 10000 个字符。请求 schema 为 strict，额外字段会被拒绝。

### Ticket List

```http
GET /api/v1/tickets
```

Adapter 调用 `GET user/ticket/fetch`。Success：

```json
{
  "ok": true,
  "data": {
    "tickets": [
      {
        "id": "7",
        "subject": "Connection issue",
        "priority": "normal",
        "status": "open",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-02T00:00:00.000Z"
      }
    ]
  },
  "requestId": "request-id"
}
```

### Ticket Detail

```http
GET /api/v1/tickets/{id}
```

Adapter 调用 `GET user/ticket/fetch?id={id}`。消息仅映射受控字段：

```json
{
  "ok": true,
  "data": {
    "id": "7",
    "subject": "Connection issue",
    "priority": "normal",
    "status": "open",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-02T00:00:00.000Z",
    "messages": [
      {
        "id": "11",
        "content": "Message text",
        "fromMe": true,
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  },
  "requestId": "request-id"
}
```

V2Board `user_id`、`ticket_id`、staff/admin ID、`reply_status` 和其他 Model 字段不会进入 Public DTO。Gateway 将 `subject`/`message` 保持为普通字符串，不渲染 HTML、不执行 Markdown，也不写入日志；最终展示时的 XSS escaping 由 Consumer renderer 负责。

### Create Ticket

```http
POST /api/v1/tickets
Content-Type: application/json
```

```json
{
  "subject": "Connection issue",
  "priority": "normal",
  "message": "Please investigate."
}
```

Adapter 将 `priority` 映射为 `level` 并调用 `POST user/ticket/save`。成功仅返回 V2Board 可以证明的结果，不伪造 ticket ID：

```json
{
  "ok": true,
  "data": { "created": true },
  "requestId": "request-id"
}
```

### Reply To Ticket

```http
POST /api/v1/tickets/{id}/reply
Content-Type: application/json
```

```json
{ "message": "Reply text" }
```

Adapter 只向 `POST user/ticket/reply` 发送数字 `id` 与 `message`。V2Board 负责存在性、ownership、closed 状态和回复顺序；Gateway 不进行预查询。

```json
{
  "ok": true,
  "data": { "replied": true },
  "requestId": "request-id"
}
```

### Close Ticket

```http
POST /api/v1/tickets/{id}/close
```

请求无 body。Adapter 只向 `POST user/ticket/close` 发送数字 `id`；ownership、存在性和状态持久化由 V2Board 负责。

```json
{
  "ok": true,
  "data": { "closed": true },
  "requestId": "request-id"
}
```

### Ticket Errors

| HTTP | Code | 场景 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | ID、subject、priority、message 或 strict body 无效 |
| 401 | `AUTH_REQUIRED` | 缺少或无法识别 Bearer credential |
| 401 | `AUTH_FAILED` | V2Board 拒绝 credential |
| 404 | `TICKET_NOT_FOUND` | V2Board 404 或 exact error 表明工单不存在 |
| 409 | `TICKET_UNAVAILABLE` | V2Board exact error 表明创建资格不满足或已有未处理工单 |
| 409 | `TICKET_REPLY_FAILED` | V2Board exact error 表明工单不可回复或回复失败 |
| 502 | `TICKET_CREATE_FAILED` | V2Board exact error 表明创建失败 |
| 502 | `TICKET_CLOSE_FAILED` | V2Board exact error 表明关闭失败 |
| 502 | `UPSTREAM_ERROR` | malformed、HTML、invalid JSON、未知或无法可靠分类的 upstream error |
| 504 | `UPSTREAM_TIMEOUT` | V2Board 请求超时 |

业务错误只按官方 `99f8526` 的完整 exact message 分类，不使用 `includes` 等模糊匹配，不返回 raw V2Board/Laravel message。所有响应使用 `Cache-Control: no-store`。`user/ticket/withdraw` 属于 Referrals / Commission 的人工提现申请，不是通用 Support Ticket 创建接口；其 Public Contract 见 Phase 2O。

## Phase 2J Notices And Traffic History

以下接口均要求 `Authorization: Bearer <opaque-token>`，继续使用统一 `V2BoardClient`、10 秒 timeout、`redirect: manual`、header allowlist 和 `Cache-Control: no-store`。Gateway 不保存公告、不缓存流量记录，也不复制 V2Board 的可见性、排序、留存或计费规则。

### Notice List

```http
GET /api/v1/notices?page=1&pageSize=20
```

`page` 默认为 1，必须是最大 `2147483647` 的正整数；`pageSize` 默认为 20，范围为 1 至 100。额外或重复 query 参数会返回 `VALIDATION_ERROR`。Adapter 映射为：

```http
GET user/notice/fetch?current=1&pageSize=20
```

Success：

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "7",
        "title": "Maintenance notice",
        "tags": ["maintenance"],
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-02T00:00:00.000Z"
      }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 1
  },
  "requestId": "request-id"
}
```

List 不返回正文。官方 Notice Model 的 `content`、`show`、`img_url` 和其他内部字段不会进入 list DTO。官方 `tags` 是 nullable array；Public Contract 稳定返回 bounded `string[]`，上游 `null` 表示没有标签并规范化为 `[]`。

### Notice Detail

```http
GET /api/v1/notices/{id}
```

Notice ID 是最大 `2147483647` 的十进制正整数字符串。Adapter 调用 `GET user/notice/fetch?id={id}`。Success：

```json
{
  "ok": true,
  "data": {
    "id": "7",
    "title": "Maintenance notice",
    "content": "<p>Scheduled maintenance</p>",
    "tags": ["maintenance"],
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-02T00:00:00.000Z"
  },
  "requestId": "request-id"
}
```

官方前端允许 Notice `content` 包含 HTML。Gateway 只把经过 string 类型和长度验证的正文作为 opaque string 返回，不渲染、不执行、不改写、不转换 Markdown；Consumer renderer 负责安全展示。即使正文包含 HTML，也不会透传整个 Notice Model。

Notice detail 的官方 HTTP 404 映射为 `404 NOTICE_NOT_FOUND`，公开 message 与上游原文解耦。malformed item、total、tags、正文或 timestamp 统一 fail closed 为 `UPSTREAM_ERROR`。

### Traffic History

```http
GET /api/v1/traffic/logs
```

Adapter 只调用：

```http
GET user/stat/getTrafficLog
```

Success：

```json
{
  "ok": true,
  "data": {
    "entries": [
      {
        "uploadedBytes": 123456,
        "downloadedBytes": 654321,
        "recordedAt": "2026-09-11T00:00:00.000Z",
        "rateMultiplier": 1.5
      }
    ]
  },
  "requestId": "request-id"
}
```

官方 `server_rate` 是节点流量扣费倍率。数据库类型为 `decimal(10,2)`，官方模型没有 numeric cast，实际 JSON 响应为两位小数字符串，例如 `"1.50"`；Adapter 严格验证该格式后映射为 Public `rateMultiplier: 1.5`。数字、宽松数字字符串或负数不会被隐式转换。

`u`/`d` 必须是非负 JavaScript safe integers，分别映射为 `uploadedBytes`/`downloadedBytes`；`record_at` 转为 ISO 8601。Gateway 保持 V2Board 返回顺序，不返回 `user_id`，不计算 `totalBytes`、`ratedBytes`、remaining、percent 或 cost。

Traffic History 当前只反映官方 V2Board 固定查询的本月 1 日至当前时间记录，不是任意日期范围的历史查询 API。Gateway 不增加 V2Board 不支持的日期过滤器或分页。

### Phase 2J Errors

| HTTP | Code | 场景 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Notice ID、page、pageSize、重复或额外 query 参数无效 |
| 401 | `AUTH_REQUIRED` | 缺少或无法识别 Bearer credential |
| 401 | `AUTH_FAILED` | V2Board 拒绝 credential |
| 404 | `NOTICE_NOT_FOUND` | V2Board 返回官方 Notice detail 404 |
| 502 | `UPSTREAM_ERROR` | malformed、HTML、invalid JSON、未知或无法可靠分类的 upstream error |
| 504 | `UPSTREAM_TIMEOUT` | V2Board 请求超时 |

Public Notice DTO 不包含 raw Model、`show` 或内部 flags；Public Traffic DTO 不包含 `user_id` 或内部数据库对象。Gateway 不增加 Notice cache、Traffic aggregation state、KV、D1、Durable Objects 或 Redis。

## Phase 2K Referrals And Commission Overview

以下接口均要求 `Authorization: Bearer <opaque-token>`。V2Board 持有邀请码生成/上限、邀请关系、佣金资格、比例、计算、结算和余额；Gateway 只验证并映射官方响应，不保存 referral/commission state，不查询后预判资格，也不计算佣金。

### Referral Overview

```http
GET /api/v1/referrals
```

Adapter 调用 `GET user/invite/fetch`，把官方 positional `stat` 数组转换为具名字段：

| Official position | Public field |
| --- | --- |
| `stat[0]` | `registeredUsers` |
| `stat[1]` | `earnedCommissionMinor` |
| `stat[2]` | `pendingCommissionMinor` |
| `stat[3]` | `commissionRatePercent` |
| `stat[4]` | `availableCommissionMinor` |

Success：

```json
{
  "ok": true,
  "data": {
    "codes": [
      {
        "code": "AbCd1234",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "stats": {
      "registeredUsers": 10,
      "earnedCommissionMinor": 1200,
      "pendingCommissionMinor": 300,
      "commissionRatePercent": 30,
      "availableCommissionMinor": 900
    }
  },
  "requestId": "request-id"
}
```

官方邀请码由 `Helper::randomChar(8)` 生成字母数字字符串，数据库上限为 32；Gateway 将 code 作为所属用户需要分享的 credential-like value 返回，但不记录日志。Public Invite Code DTO 只包含 `code/createdAt`，不包含内部 `id`、`user_id`、`status`、`pv` 或 raw Eloquent Model。

`stat` 必须恰好包含 5 个值。用户数量和金额必须是非负 safe integers，commission rate 必须是 0 至 100 的整数。缺项、额外项、字符串、负数、浮点数或超出安全范围均 fail closed 为 `UPSTREAM_ERROR`。

### Create Referral Code

```http
POST /api/v1/referrals/codes
```

Public 请求无 body。官方 V2Board 的创建 route 使用 GET，因此 Adapter 只发出一次：

```http
GET user/invite/save
```

Success：

```json
{
  "ok": true,
  "data": { "created": true },
  "requestId": "request-id"
}
```

Gateway 不预查现有 code 数量、不复制 `invite_gen_limit`、不生成 code，也不为了猜测新 code 再组合本地状态。Client 如需刷新列表，应重新调用 `GET /api/v1/referrals`。官方 exact error `The maximum number of creations has been reached` 及其官方中文翻译映射为 `409 REFERRAL_CODE_LIMIT_REACHED`，不透传 raw message；部分字符串匹配不会被分类。

### Commission History

```http
GET /api/v1/referrals/commissions?page=1&pageSize=20
```

`page` 默认为 1，必须是最大 `2147483647` 的正整数；`pageSize` 默认为 20，范围为 10 至 100。较小值被 Public Contract 拒绝，因为官方 V2Board 会把 `page_size < 10` 强制改为 10。额外或重复 query 参数同样被拒绝。

Adapter 映射为：

```http
GET user/invite/details?current=1&page_size=20
```

Success：

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "orderAmountMinor": 1000,
        "commissionAmountMinor": 100,
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 1
  },
  "requestId": "request-id"
}
```

官方 `order_amount`、`get_amount`、Order `total_amount/commission_balance` 和 User `commission_balance` 均为整数最小货币单位；支付实现只在 Provider 展示金额边界除以 100。Gateway 因此原样映射为 `orderAmountMinor`、`commissionAmountMinor` 和 stats 的 `*CommissionMinor`，不除以 100、不换汇、不猜币种。`commission_rate` 是 0 至 100 的整数百分数，官方用 `/100` 参与自身计算；Gateway 原样映射为 `commissionRatePercent`，例如 30 表示 30%，不转换成 0.3。

CommissionLog `trade_no` 可能属于被邀请用户的订单，Public DTO 绝不返回它，也不返回 CommissionLog `id`、`user_id`、`invite_user_id` 或其他订单字段。`commissionAmountMinor` 只能来自官方 `get_amount`，不得通过订单金额乘比例重算。

### Multi-Level Commission Distribution

solution 不支持 V2Board multi-level commission distribution（多级分销）。这是明确且永久的 Non-goal，当前项目不计划增加多级佣金兼容逻辑。所有 solution 部署必须保持 V2Board `commission_distribution_enable` 为 disabled / `0`。

在该受支持配置下，`pendingCommissionMinor` 保持 integer minor unit。solution 不接受 fractional pending commission，也不对金额执行 `round`、`floor`、`ceil`、truncate 或其他隐式修正。

如果 upstream 在不受支持的多级分销配置下返回 fractional pending commission，Gateway fail closed 为 `UPSTREAM_ERROR` 是预期行为，不属于兼容性缺陷。

### Phase 2K Errors

| HTTP | Code | 场景 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | commission page/pageSize、重复或额外 query 参数无效 |
| 401 | `AUTH_REQUIRED` | 缺少或无法识别 Bearer credential |
| 401 | `AUTH_FAILED` | V2Board 拒绝 credential |
| 409 | `REFERRAL_CODE_LIMIT_REACHED` | V2Board exact error 表明邀请码创建数量达到上限 |
| 502 | `UPSTREAM_ERROR` | malformed、HTML、invalid JSON、未知或无法可靠分类的 upstream error |
| 504 | `UPSTREAM_TIMEOUT` | V2Board 请求超时 |

所有响应使用 `Cache-Control: no-store`。邀请码、佣金记录、Bearer token 和 raw upstream referral data 不进入日志。Phase 2K 本身不提供 mutation；后续 Phase 2N/2O 仅以 additive extension 增加 commission transfer 和人工 withdrawal request，自动打款仍不提供。

## Phase 2L v1 Contract Freeze

solution v1 Public Contract baseline 已冻结；后续功能只允许向后兼容的 additive extension。Phase 2W 增加最小 Account / Onboarding Config 后，本文件顶部矩阵包含 44 个真实 source routes。所有 Public route 都位于 `/api/v1`；不存在 `/api/v1/access` 或 `/r/v1/{credential}`。唯一 subscription content route 是 `GET /api/v1/access/subscription?token=...`。

v1 已实现范围包括 Authentication、Account、Catalog、Orders、Billing/Checkout、Promotions、Subscription、Tickets、Notices、Traffic 和 Referrals。V2Board 继续拥有用户、订单、支付、subscription、ticket、notice、traffic、invite 与 commission 的全部业务状态；Gateway 只提供稳定 Contract、验证、映射、字段过滤、错误规范化、受控 header forwarding 和 subscription streaming。

以下为明确且永久的 solution Non-goals：

- **Telegram**：不提供 bind、unbind、Telegram login 或 Telegram Public API。V2Board 内部可能产生的管理员 Telegram notification side effect 不属于 solution Public Contract，也不是 solution dependency。
- **Knowledge / 知识库**：不提供 list、detail、content transformation，也不处理其中的 `subscribe_url`、`subscribeToken` 或 encoded subscription URL。
- **Multi-level commission distribution**：不支持；部署必须保持 `commission_distribution_enable=0`。`pendingCommissionMinor` 保持 integer minor unit，不增加 fractional compatibility。

Gift Card 管理/创建/list/preview、Active Session、Quick Login、automatic payout、withdrawal admin，以及直接暴露 V2Board `newPeriod` / `resetSecurity` controller 命名不属于 solution v1 Public Contract。不存在这些功能的 placeholder route；请求应按未知 Public route 返回 404。

## Phase 2M Gift Card Redemption

```http
POST /api/v1/gift-cards/redeem
Authorization: Bearer <opaque-token>
Content-Type: application/json
```

```json
{ "code": "gift-card-code" }
```

`code` 必填，长度 1 至 255，保持大小写和首尾字符原样；strict schema 拒绝额外字段。Adapter 只映射为 `{ "giftcard": "..." }` 并调用官方 `POST user/redeemgiftcard`。Gateway 不查询 Giftcard/Plan、不预判资格、不生成或保存 code，也不修改任何业务状态。

成功要求官方严格返回 `data=true` 与 numeric `type`。Public `effect` 为：

```text
type=1 -> { type: "balance", amountMinor: integer }
type=2 -> { type: "validity", days: integer }
type=3 -> { type: "traffic", gigabytes: integer }
type=4 -> { type: "trafficReset" }
type=5, value!=0 -> { type: "plan", durationDays: signed integer }
type=5, value=0 -> { type: "plan", durationDays: null }
```

Response：

```json
{
  "ok": true,
  "data": {
    "redeemed": true,
    "effect": { "type": "traffic", "gigabytes": 1 }
  },
  "requestId": "request-id"
}
```

官方 Gift Card `value` 是 signed INT，合法范围为 `-2147483648..2147483647`，Gateway 在 effect DTO 中原样报告，不限制或解释其业务方向，也不执行 abs、round、floor、ceil、truncate、clamp 或其他转换；Gift Card 配置正确性由 V2Board/Admin 管理。这不是新增“扣余额卡”等产品能力。

Type 1 `value` 是 V2Board 最小货币单位，Gateway 不除以 100、不猜币种。Type 2/5 是天数，Gateway 不计算 `expiresAt`；Type 5 仅将官方明确的 `value=0` 规范化为 `durationDays=null`，负数保持原值。Type 3 是官方 GiB 数量，Gateway 不转换 bytes。Type 4 忽略无业务意义的 value。余额、有效期、流量、套餐、使用次数和 per-user usage 全由 V2Board 原子事务处理。

| HTTP | Code |
| --- | --- |
| 400 | `VALIDATION_ERROR` |
| 401 | `AUTH_REQUIRED` / `AUTH_FAILED` |
| 404 | `GIFT_CARD_NOT_FOUND` |
| 409 | `GIFT_CARD_NOT_ACTIVE` / `GIFT_CARD_EXPIRED` |
| 409 | `GIFT_CARD_USAGE_LIMIT_REACHED` / `GIFT_CARD_ALREADY_REDEEMED` |
| 409 | `GIFT_CARD_NOT_APPLICABLE` |
| 502 | `GIFT_CARD_REDEEM_FAILED` / `UPSTREAM_ERROR` |
| 504 | `UPSTREAM_TIMEOUT` |

业务错误只按官方完整 exact message 映射，不返回 raw V2Board/Laravel message。Gift Card code 不进入响应、application log 或 request metadata。兑换是非幂等 mutation，Gateway 不自动 retry；收到 `UPSTREAM_TIMEOUT` 后，Client 不应盲目重复提交，应先刷新 subscription overview 或其他权威账户状态。再次提交得到 `GIFT_CARD_ALREADY_REDEEMED` 不能由 Gateway 自动推断第一次结果。

Gift Card 管理、创建、list、preview 不属于 solution Public Contract。Admin Gift Card 能力仅可用于受控 staging 验收。

## Phase 2N Commission Transfer

```http
POST /api/v1/referrals/commissions/transfer
Authorization: Bearer <opaque-token>
Content-Type: application/json
```

Request：

```json
{ "amountMinor": 100 }
```

`amountMinor` 必须是 `1..2147483647` 的整数；strict schema 拒绝字符串、浮点数、额外字段和 upstream 字段名 `transfer_amount`。

Adapter 只发出一次以下请求，不执行 pre-check 或后续 read：

```http
POST user/transfer
Content-Type: application/json

{ "transfer_amount": 100 }
```

只有官方响应严格满足 `{ "data": true }` 才视为成功。Public Response：

```json
{
  "ok": true,
  "data": { "transferred": true },
  "requestId": "request-id"
}
```

Gateway 不返回新余额或 V2Board 创建的 deposit Order。commission 余额判断、`commission_balance` 扣减、站内 `balance` 增加、事务与 deposit Order 创建全部由 V2Board 拥有；Gateway 不查询余额、不计算资金、不创建 Order、不保存 mutation state。

| HTTP | Code | 场景 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Public request 不符合 strict schema |
| 401 | `AUTH_REQUIRED` / `AUTH_FAILED` | 缺少 credential 或 V2Board 拒绝 credential |
| 409 | `INSUFFICIENT_COMMISSION_BALANCE` | V2Board exact error 表明佣金余额不足 |
| 502 | `COMMISSION_TRANSFER_FAILED` | V2Board exact error 表明 transfer transaction/save 失败 |
| 502 | `UPSTREAM_ERROR` | malformed success、HTML、invalid JSON 或未知 upstream error |
| 504 | `UPSTREAM_TIMEOUT` | V2Board 请求超时；资金 mutation 结果未知 |

Commission Transfer 是非幂等资金 mutation。Gateway 不自动 retry，也不实现 idempotency state。收到 `UPSTREAM_TIMEOUT` 表示 V2Board 可能已经提交，也可能尚未提交；Client 不得立即盲目重试，应先通过 `GET /api/v1/referrals` 刷新权威 `availableCommissionMinor` 及相关账户状态，再由用户决定下一步。Gateway 不根据后续 read 自动推断第一次 transfer 的结果。

成功与错误响应均使用 `Cache-Control: no-store`。Public response 不包含 raw balance、commission model、deposit Order、V2Board error message 或内部字段；amount、Bearer token 和 raw upstream payload 不进入日志。Phase 2O 仅增加人工 withdrawal request；自动打款、Gateway 资金计算和资金状态存储仍是 Non-goals。

## Phase 2O Commission Withdrawal Request

Withdrawal 是由 V2Board 创建、交由管理员后续处理的申请工单，不是自动提现或 payout。所有响应使用 `Cache-Control: no-store`。

### Withdrawal Options

```http
GET /api/v1/referrals/withdrawal-options
Authorization: Bearer <opaque-token>
```

Adapter 调用 `GET user/comm/config`，只消费官方 `withdraw_close` 和 `withdraw_methods`：`withdraw_close=0` 映射为 `enabled=true`，`1` 映射为 `false`；methods 保持原顺序和原字符串，即使 disabled 也不清空。Stripe、Telegram、currency、commission distribution 和其他 raw Comm config 字段全部丢弃。

```json
{
  "ok": true,
  "data": {
    "enabled": true,
    "methods": ["支付宝", "USDT", "Paypal"]
  },
  "requestId": "request-id"
}
```

官方 user-facing `user/comm/config` 不公开 `commission_withdraw_limit`。solution 不调用 Admin API、不读取数据库、不增加 env 或硬编码副本，因此 Public Contract 有意不提供 `minimumAmountMinor`；minimum 资格由 V2Board 在提交时判断。

### Create Withdrawal Request

```http
POST /api/v1/referrals/withdrawal-requests
Authorization: Bearer <opaque-token>
Content-Type: application/json
```

```json
{
  "method": "USDT",
  "account": "recipient-account"
}
```

`method` 长度为 1 至 255，`account` 长度为 1 至 1024；Gateway 不 trim、翻译、改变大小写或执行 Provider-specific account 验证。strict schema 拒绝额外字段、`withdraw_method/withdraw_account` upstream alias，以及 `amount`、`amountMinor`、`withdrawAmount` 或其他金额字段。

Adapter 不读取 options、commission 或 minimum，直接发出且只发出一次：

```http
POST user/ticket/withdraw
Content-Type: application/json

{
  "withdraw_method": "USDT",
  "withdraw_account": "recipient-account"
}
```

只有官方响应严格满足 `{ "data": true }` 才返回 HTTP 201：

```json
{
  "ok": true,
  "data": { "requested": true },
  "requestId": "request-id"
}
```

`requested=true` 只表示 V2Board 已创建提现申请 Ticket 和 TicketMessage，不表示管理员批准、payout 完成、资金发送、commission 已扣除或冻结。官方此调用不会改变 `commission_balance` 或站内 `balance`；Gateway 同样不计算、保留或修改任何资金状态。V2Board commit 后可能执行内部管理员 Telegram notification，这不是 solution Telegram Public 功能或依赖。

| HTTP | Code | 场景 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Public request 不符合 strict schema |
| 401 | `AUTH_REQUIRED` / `AUTH_FAILED` | 缺少 credential 或 V2Board 拒绝 credential |
| 409 | `WITHDRAWAL_DISABLED` | 官方 raw literal 表明 withdrawal 已关闭 |
| 422 | `WITHDRAWAL_METHOD_UNSUPPORTED` | V2Board exact error 表明 method 不在当前配置中 |
| 409 | `WITHDRAWAL_MINIMUM_NOT_MET` | 官方完整动态 minimum message 被严格识别 |
| 502 | `WITHDRAWAL_REQUEST_FAILED` | V2Board exact error 表明 Ticket/Message 创建失败并 rollback |
| 502 | `UPSTREAM_ERROR` | malformed success、HTML、invalid JSON 或未知 upstream error |
| 504 | `UPSTREAM_TIMEOUT` | V2Board 请求超时，Ticket mutation 结果未知 |

Minimum error 只通过官方源码与 staging 验证的完整锚定结构识别：英文固定完整前缀后只能是 numeric limit；中文固定完整前后缀之间只能是 numeric limit。Gateway 不使用 `includes`、partial prefix 或宽泛 regex，也不在 Public error 中返回 minimum 或 raw upstream message。

Withdrawal Request 是非幂等 mutation，每次成功请求都可能创建新工单。Gateway 不 retry、不搜索 Ticket、不 dedupe，也不实现 idempotency storage。`UPSTREAM_TIMEOUT` 或提交后的未知 `UPSTREAM_ERROR` 不能解释为“肯定未创建”；Client 不得盲目重提，应先调用 `GET /api/v1/tickets`，必要时再调用 `GET /api/v1/tickets/{id}` 检查是否已有新的 Withdrawal Request Ticket。Gateway 不自动推断第一次请求结果。

Withdrawal account 是敏感财务信息：它不出现在 withdrawal success/error response、application log、request metadata 或 tracing custom field。现有 owner-authenticated Ticket Detail 仍可能按 V2Board 原始 TicketMessage 显示用户自己的 account；该读取行为不改变现有 Ticket DTO，Ticket message 同样不进入 application log。

Automatic payout、payout provider integration、amount selection、commission reservation/deduction/freeze、admin withdrawal management、Gateway withdrawal state 和 duplicate detection 均不属于 solution Public Contract。

## Phase 2P Subscription Credential Rotation

```http
POST /api/v1/subscription/rotate-access
Authorization: Bearer <opaque-token>
```

Request body：无。Public Contract 使用 POST 表达 credential mutation，不暴露官方 `resetSecurity` 命名，也不要求发送 `{}`。GET 同路径不是有效 API，且绝不触发 mutation。

rotation 复用 `GET /api/v1/subscription` 已有的 previous-purchaser eligibility policy：V2Board 订单历史必须至少存在一笔 `plan_id>0` 且 status 为 1、3 或 4 的订单。空历史、只有 pending/cancelled 或只有 `plan_id=0` deposit order 时返回 `409 SUBSCRIPTION_ACCESS_UNAVAILABLE`，只执行 `GET user/order/fetch`，不调用 `resetSecurity`。

eligible 成功路径严格包含两次 upstream 调用：

```text
GET user/order/fetch
GET user/resetSecurity
```

不会先调用 `user/getSubscribe`，也不会执行额外 refresh。官方第二个 GET 实际会修改 `user.uuid` 和 `user.token`；Gateway 将其视为非幂等 mutation。官方 response 的 `data` 必须是长度 1 至 8192 的 subscription URL，并继续通过现有 `extractSubscriptionToken` / `validateSubscriptionToken` 完整安全边界提取新 token。

Success：

```json
{
  "ok": true,
  "data": {
    "rotated": true,
    "accessUrl": "https://gateway.example/api/v1/access/subscription?token=new-credential"
  },
  "requestId": "request-id"
}
```

`accessUrl` 使用经过 `validateGatewayPublicOrigin` 验证的当前 solution HTTPS origin 构建，与 `GET /api/v1/subscription` 一致。Public response 不返回 standalone token、UUID、raw V2Board URL、V2Board hostname 或 subscribe path；新 token 只允许作为 authenticated eligible user 响应中的 solution-owned access URL credential。token、UUID 和 raw URL 不进入 application log、error log、request metadata 或 tracing custom field。

Rotation 会同时替换 V2Board token 和 UUID。旧 subscription URL 将失效；此前客户端已经拉取的旧节点 UUID 也可能失效，客户端需要使用新 access URL 重新获取订阅。这不是单纯刷新 UI URL。

| HTTP | Code | 场景 |
| --- | --- | --- |
| 401 | `AUTH_REQUIRED` / `AUTH_FAILED` | 缺少 credential 或 V2Board 拒绝 credential |
| 409 | `SUBSCRIPTION_ACCESS_UNAVAILABLE` | 不满足已有 previous-purchaser access policy；不会执行 mutation |
| 502 | `SUBSCRIPTION_ROTATION_FAILED` | 官方 exact `Reset failed` / `重置失败` |
| 502 | `UPSTREAM_ERROR` | malformed URL/response、HTML、invalid JSON 或未知 upstream error |
| 504 | `UPSTREAM_TIMEOUT` | rotation 结果未知 |

官方 `99f8526` 的保存失败原文是 `Reset failed`，不是 `Save failed`；Adapter 只匹配经过源码确认的 exact 英文及中文翻译。`The user does not exist` 和其他未知错误遵循通用 `UPSTREAM_ERROR`，raw message 不对外返回。

Rotation 不可自动重试：盲目重试会再次生成 credential，使 Client 可能刚收到的新 URL 立即失效。`UPSTREAM_TIMEOUT` 或 mutation 上的未知 `UPSTREAM_ERROR` 都可能发生在 V2Board 保存后；Client 应先调用 `GET /api/v1/subscription` 获取当前权威 solution access URL，而不是立即再次 rotate。Gateway 不执行自动 recovery read、不推断第一次结果，也不保存 current/previous token、rotation state 或 idempotency state。

Gateway 保持 stateless；不增加 KV、D1、Durable Objects、Redis、数据库或 idempotency key。Existing subscription metadata、overview、verbatim streaming、User-Agent forwarding 和 response header allowlist 均保持不变。

## Phase 2Q Advance Subscription Period

```http
POST /api/v1/subscription/advance-period
Authorization: Bearer <opaque-token>
```

Request body：无。Public `advance-period` 表示在 V2Board 允许的条件下提前进入下一流量周期，不暴露 upstream `newPeriod` 命名。GET 同路径不是有效 API，也不会触发 mutation。

Adapter 直接且只调用一次：

```http
POST user/newPeriod
```

请求不发送 body，也不发送 `reset_day`、`reset_period`、`expires_at`、`u`、`d`、`plan_id` 或 `transfer_enable`。Gateway 不先调用 overview、order、getSubscribe 或其他资格查询；是否允许 advance、流量是否耗尽、reset method/day/period 与剩余有效期全部由 V2Board 在 transaction 中权威判断和计算。

只有官方 response 严格满足 `{ "data": true }` 才视为成功：

```json
{
  "ok": true,
  "data": { "advanced": true },
  "requestId": "request-id"
}
```

Gateway 不在成功后执行第二次 read，也不返回新旧 expiresAt、reset days、流量或 Plan 内部配置。Client 如需最新状态，应重新请求 `GET /api/v1/subscription/overview`。

Advance 不是免费延长订阅。成功时 V2Board 会把 `u/d` 归零，并按自己的 reset day/period 算法减少 `expired_at`，因此 Public `expiresAt` 可能变早。Gateway 不复制 `transfer_enable > u+d`、`UserService::getResetDay/getResetPeriod`、month/year switch、86400 秒换算或任何有效期计算。

| HTTP | Code | 场景 |
| --- | --- | --- |
| 401 | `AUTH_REQUIRED` / `AUTH_FAILED` | 缺少 credential 或 V2Board 拒绝 credential |
| 409 | `SUBSCRIPTION_PERIOD_ADVANCE_DISABLED` | 官方 exact `Renewal is not allowed` |
| 409 | `SUBSCRIPTION_TRAFFIC_NOT_EXHAUSTED` | 官方 exact error 表明仍有剩余流量 |
| 409 | `SUBSCRIPTION_PERIOD_ADVANCE_UNAVAILABLE` | reset policy 或剩余有效期使当前状态不可 advance |
| 502 | `SUBSCRIPTION_PERIOD_ADVANCE_FAILED` | 官方 exact `Save failed` / `保存失败` |
| 502 | `UPSTREAM_ERROR` | invalid reset period、用户缺失、malformed success、HTML、invalid JSON 或未知错误 |
| 504 | `UPSTREAM_TIMEOUT` | mutation 结果未知 |

官方 `99f8526` 的功能禁用、流量未耗尽、advance 不可用和 invalid reset period 字符串在 translation JSON 中没有本地化条目，staging 的禁用错误也验证为原始英文；Adapter 只按源码中的完整 exact 英文匹配。保存失败同时接受官方英文和已确认中文翻译。所有 raw V2Board/Laravel message 均不进入 Public response。

Advance 是非幂等 subscription state mutation。Gateway 不自动 retry，也不依赖“第二次通常会失败”作为幂等保证。`UPSTREAM_TIMEOUT` 或 mutation 上无法确认结果的 `UPSTREAM_ERROR` 可能发生在 V2Board commit 后；Client 不得立即重复提交，应先调用 `GET /api/v1/subscription/overview` 检查当前 authoritative `traffic`、`expiresAt` 和 `resetDay`。Gateway 不自动 recovery read，也不推断第一次请求一定成功或失败。

V2Board 拥有 transaction、rollback、`u/d` 更新和 `expired_at` 计算。Gateway 保持 stateless，不增加 KV、D1、Durable Objects、Redis、数据库、mutation state、previous-expiry cache 或 idempotency key。Existing subscription metadata、overview、credential rotation、access streaming、User-Agent forwarding 和 header allowlist 保持不变。

## Phase 2T Wallet Balance Read

```http
GET /api/v1/wallet
Authorization: Bearer <opaque-token>
```

Adapter 只调用一次官方 `GET user/info`，严格解析 `data.balance` 并忽略其余 User Model 字段。

```json
{
  "ok": true,
  "data": { "balanceMinor": 12345 },
  "requestId": "request-id"
}
```

`balanceMinor` 是 V2Board 当前用户的站内余额，原样使用官方整数 minor unit。Gateway 不执行 `/100`、`*100`、货币换算、浮点转换，也不从 Order、commission、pending deposit 或其他数据推导余额。官方 `v2_user.balance` 使用 signed INT storage；Public schema fail closed 地只接受业务合法的 `0..2147483647` 整数。

Wallet DTO 只包含 `balanceMinor`。`email`、UUID、Telegram ID、`commission_balance`、commission rate、discount、plan、device、登录/创建时间和 raw User Model 均不会进入响应。Commission balance 继续属于 Referrals domain，不与 Wallet balance 相加。

缺少或无效 Bearer 分别使用 `AUTH_REQUIRED` / `AUTH_FAILED`。负数、浮点、numeric string、null、缺失 balance、HTML、invalid JSON、用户缺失或其他 malformed upstream response fail closed 为 `502 UPSTREAM_ERROR`；timeout 为 `504 UPSTREAM_TIMEOUT`。所有响应使用 `Cache-Control: no-store`。

V2Board 继续拥有 Wallet 的全部 mutation，包括 deposit、commission transfer、Gift Card、订单余额抵扣以及 cancellation/refund 恢复。Gateway 不创建 ledger、不缓存 balance、不保存 snapshot，也不增加 KV、D1、Durable Objects、Redis 或数据库。Phase 2U 仅以 V2Board 原生 Deposit Order 暴露充值创建，其他资金 mutation 不变。

现有 `GET /api/v1/me` DTO 保持不变，仍只包含 `email`、`expiresAt` 和 `status`。

## Phase 2U Wallet Deposit

```http
POST /api/v1/wallet/deposits
Authorization: Bearer <opaque-token>
Content-Type: application/json
```

```json
{ "amountMinor": 1000 }
```

`amountMinor` 必须是 `1..2147483647` 的整数。Gateway 不接受字符串、浮点、零、负数、额外字段或 upstream `deposit_amount` alias，也不复制 V2Board 当前的具体 deposit 业务上限。

Adapter 直接且只调用一次官方 Order Create：

```http
POST user/order/save
Content-Type: application/json

{
  "plan_id": 0,
  "period": "deposit",
  "deposit_amount": 1000
}
```

不会先调用 wallet、user info、orders、payment methods 或 config，也不会在成功后自动读取 Order/Wallet。只有 official response 严格返回合法 `trade_no` 才以 HTTP 201 返回：

```json
{
  "ok": true,
  "data": { "id": "deposit-order-id" },
  "requestId": "request-id"
}
```

创建 Deposit Order 不代表 Wallet 已到账。完整流程继续复用现有 Public Contract：

```text
POST /api/v1/wallet/deposits
GET /api/v1/billing/methods
POST /api/v1/orders/{id}/checkout
GET /api/v1/orders/{id}/status
GET /api/v1/wallet
```

Payment Provider callback 仍直接进入 V2Board。solution 不增加 wallet checkout、callback、payment session 或支付状态。V2Board 自己创建 `plan_id=0/period=deposit/type=9` Order，处理 payment 与 handling fee，并在 callback/order processing 后计算 deposit bonus、原子增加 `user.balance` 和完成 Order transaction。

现有 Order list/detail/status/cancel/checkout 能继续处理 Deposit Order。Public Order DTO 不增加 `type`、`period`、`plan`、`bounus` 或 `get_amount`；最终到账余额以 `GET /api/v1/wallet` 为权威。

| HTTP | Code | 场景 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Public amountMinor 不符合通用 signed INT minor-unit boundary |
| 401 | `AUTH_REQUIRED` / `AUTH_FAILED` | 缺少 credential 或 V2Board 拒绝 credential |
| 409 | `WALLET_DEPOSIT_UNAVAILABLE` | 官方 exact error 表明已有 pending/processing Order |
| 422 | `WALLET_DEPOSIT_AMOUNT_INVALID` | 官方 exact error 拒绝 Deposit amount 业务规则 |
| 502 | `WALLET_DEPOSIT_CREATE_FAILED` | 官方 exact error 表明 Order save 失败 |
| 502 | `UPSTREAM_ERROR` | malformed trade_no、HTML、invalid JSON 或未知 upstream error |
| 504 | `UPSTREAM_TIMEOUT` | Deposit Order 创建结果未知 |

错误仅按官方 `99f8526` 源码和 translation 的完整 exact message 分类，不返回 raw V2Board/Laravel message。Gateway 不自动 retry；收到 `UPSTREAM_TIMEOUT` 后，V2Board 可能已创建 Deposit Order，Client 应先调用 `GET /api/v1/orders` 检查后再决定是否重新提交。

Gateway 不计算或修改 balance，不读取/预测 `deposit_bounus`，不计算 credited amount/handling fee，不处理 callback，也不建立 deposit session、wallet ledger、pending balance、bonus cache、idempotency state、KV、D1、Durable Objects、Redis 或数据库。币种仍由 V2Board 部署配置决定，本 Contract 不硬编码 CNY、USD 或 currency symbol。

## Phase 2W Minimal Account / Onboarding Config

三个接口各自只调用一个 Official endpoint，不聚合成 mega-config，不保存 config/preferences snapshot，不增加 KV、D1、Durable Objects、Redis 或数据库。成功和错误响应均使用 `Cache-Control: no-store`。

### Onboarding Config

```http
GET /api/v1/config/onboarding
```

本接口无需 Bearer，只调用一次 `GET guest/comm/config`：

```json
{
  "ok": true,
  "data": {
    "termsUrl": null,
    "emailVerificationRequired": false,
    "inviteCodeRequired": false,
    "emailSuffixWhitelist": null,
    "antiBot": {
      "enabled": false,
      "provider": null,
      "siteKey": null
    }
  },
  "requestId": "request-id"
}
```

| Official field | Public field | Rule |
| --- | --- | --- |
| `tos_url` | `termsUrl` | `null`/空字符串映射为 `null`；非空值只允许无 credential 的 HTTP/HTTPS URL |
| `is_email_verify` | `emailVerificationRequired` | 严格 `0/1` 映射为 boolean |
| `is_invite_force` | `inviteCodeRequired` | 严格 `0/1` 映射为 boolean |
| `email_whitelist_suffix` | `emailSuffixWhitelist` | `0` 映射为 `null`；array item trim 后原样返回，不自行补 `@` 或 `.` |
| `is_recaptcha` / `recaptcha_site_key` | `antiBot` | enabled 时 provider 为 `recaptcha` 且 site key 必须是非空受限字符串；disabled 时 provider/siteKey 始终为 `null` |

Onboarding Config 只描述 registration requirements，不承诺 registration 当前一定开放。Public Contract 不提供 `registrationOpen` 或等价字段；实际注册资格仍由 `POST /api/v1/auth/register` 和 V2Board 权威裁决。

`antiBot.provider="recaptcha"` 是当前 Official V2Board 的 capability discovery，不会把 Auth mutation 绑定到 provider。`POST /api/v1/auth/email-code` 和 `POST /api/v1/auth/register` 仍只接受 provider-neutral `challengeToken`，Adapter 内部继续映射为 `recaptcha_data`。本 Phase 不增加 `recaptchaData`、challenge endpoint 或 Gateway anti-bot state。

Public DTO 不包含 Official guest config 的 app URL、description、logo 或 raw config，也不请求 Terms URL 内容。

### Account Preferences Read

```http
GET /api/v1/me/preferences
Authorization: Bearer <opaque-token>
```

Adapter 只调用一次 `GET user/info`，只解析 `auto_renewal`、`remind_expire`、`remind_traffic`。Official `0/1` 或 boolean 映射为稳定 boolean，numeric/string booleans 不被接受。

```json
{
  "ok": true,
  "data": {
    "autoRenewal": true,
    "remindExpire": true,
    "remindTraffic": false
  },
  "requestId": "request-id"
}
```

V2Board 是 preference 当前值的唯一权威。User Model 中的 email、balance、commission、UUID、Telegram、plan、discount、login/created time、device/expiry/traffic 字段全部丢弃。现有 `PATCH /api/v1/me/preferences` 契约、strict request schema、boolean-to-`0/1` 映射和 response 完全不变。

### Account Config

```http
GET /api/v1/config/account
Authorization: Bearer <opaque-token>
```

Adapter 只调用一次 `GET user/comm/config`，严格白名单映射：

```json
{
  "ok": true,
  "data": {
    "currency": "CNY",
    "currencySymbol": "¥"
  },
  "requestId": "request-id"
}
```

`currency` 和 `currencySymbol` 都是 trim 后 1 至 16 字符的字符串。Gateway 不限制 currency enum、不假设 symbol、不换算金额；Products、Wallet 和 Orders 继续使用 V2Board minor unit，不在各 DTO 重复 currency。

Public DTO 不包含 Stripe public key/route、Telegram config、withdrawal methods/flags、multi-level commission config 或 raw `user/comm/config`。Withdrawal 继续使用已有独立 Public Contract，Stripe Card Flow、Telegram 和 multi-level commission 仍是 Non-goals。

### Phase 2W Errors

| HTTP | Code | 场景 |
| --- | --- | --- |
| 401 | `AUTH_REQUIRED` | Preferences / Account Config 缺少 Bearer credential |
| 401 | `AUTH_FAILED` | V2Board 拒绝 Preferences / Account Config credential |
| 502 | `UPSTREAM_ERROR` | malformed field、非法 Terms URL、矛盾 anti-bot config、HTML、invalid JSON 或未知 upstream error |
| 504 | `UPSTREAM_TIMEOUT` | V2Board 请求超时 |
