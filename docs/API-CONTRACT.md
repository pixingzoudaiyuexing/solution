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
      "updatedAt": "2024-01-02T00:00:00.000Z"
    }
  ],
  "requestId": "request-id"
}
```

`id` 来自 V2Board `trade_no`。`amountMinor` 直接使用 V2Board 的整数 `total_amount`，Gateway 不进行浮点金额运算。V2Board `order/fetch` 不返回明确 currency，因此币种仍属于待解决契约项。

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
    "updatedAt": null
  },
  "requestId": "request-id"
}
```

payment callback、refund、coupon、subscription 路由均未实现。

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

Payment Provider callback 直接进入 V2Board。Gateway 不提供 callback/webhook 路由，不验证 provider 签名，不修改订单状态，也不保存 payment session 或 QR 状态。Client Application 使用已有 Order Detail API 查询最终订单状态。

### Order Expiration Compatibility

固定兼容基线 `wyx2685/v2board` `99f8526eddb72a4e8f6cbccd58cc0656bb91fe88` 通过异步订单任务取消创建超过两小时的 pending 订单，但当前订单 API 没有返回权威 expiry 字段，checkout 也没有同步拒绝达到该时间的 pending 订单。因此当前合同状态为：

```text
NEEDS_V2BOARD_EXPIRY_PATCH
```

本版本不提供 `expiresAt`，也不实现 `ORDER_EXPIRED`，Gateway 不创建独立过期计时器。最低上游补丁要求是：V2Board 返回权威 `expires_at`，并在 checkout 内按同一权威规则拒绝过期订单。

### Payment Errors

| HTTP | Code                         | 场景 |
| ---- | ---------------------------- | ---- |
| 400  | `VALIDATION_ERROR`           | order ID、JSON body 或 payment method ID 无效 |
| 401  | `AUTH_REQUIRED`              | 缺少或无法识别 Bearer credential |
| 401  | `AUTH_FAILED`                | V2Board 拒绝当前 credential |
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
