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
| `GET /api/v1/purchases`                | Yes            | `user/order/fetch`              |
| `POST /api/v1/purchases`               | Yes            | `user/order/save`               |
| `GET /api/v1/purchases/{id}`           | Yes            | `user/order/detail`             |
| `GET /api/v1/purchases/{id}/status`    | Yes            | `user/order/check`              |
| `POST /api/v1/purchases/{id}/checkout` | Yes            | `user/order/checkout`           |
| `POST /api/v1/purchases/{id}/cancel`   | Yes            | `user/order/cancel`             |
| `GET /api/v1/billing/methods`          | Yes            | `user/order/getPaymentMethod`   |
| `POST /api/v1/promotions/validate`     | Yes            | `user/coupon/check`             |
| `GET /api/v1/access`                   | Yes            | `user/getSubscribe`             |
| `GET /api/v1/resources`                | Yes            | `user/server/fetch`             |
| `GET /r/v1/{credential}`               | URL credential | client subscribe                |

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
