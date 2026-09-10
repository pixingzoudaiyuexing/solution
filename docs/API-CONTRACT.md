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

`POST /api/v1/orders/{id}/checkout` 及 payment、callback、refund、coupon、subscription 路由均未实现。

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
