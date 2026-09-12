# solution

Cloudflare Workers 上的 V2Board 适配层。保持无状态，不接管 V2Board 的订单、支付、余额、订阅等业务状态。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pixingzoudaiyuexing/solution)

## 一键部署

点击上方 **Deploy to Cloudflare**，登录 Cloudflare 后按页面提示完成部署。

首次部署需要填写 3 个配置：

| 配置项 | 说明 | 示例 |
| --- | --- | --- |
| `V2BOARD_BASE_URL` | V2Board API 基础地址，必须为 HTTPS，并包含 `/api/v1/` | `https://panel.example.com/api/v1/` |
| `V2BOARD_SUBSCRIBE_PATH` | V2Board 原始订阅路径 | `/api/v1/client/subscribe` |
| `FRONTEND_ORIGINS` | 允许访问 Worker API 的前端 Origin；多个 Origin 用英文逗号分隔，不要填写 `*` | `https://www.example.com,https://app.example.com` |

部署完成后，Cloudflare 会为 Worker 分配 `workers.dev` 地址。也可以在 Cloudflare Dashboard 中为 Worker 绑定自己的自定义域名。

> `V2BOARD_BASE_URL` 不要填写后台管理页面 URL，也不要省略 `/api/v1/`。

## 手动部署

需要 Node.js 和 npm。

```bash
npm ci
npx wrangler login
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`，填入自己的配置，然后上传为 Worker Secrets 并部署：

```bash
npx wrangler secret bulk .dev.vars
npm run deploy
```

`.dev.vars` 已被 `.gitignore` 忽略，不要把真实配置提交到 Git。

## 可选：Cloudflare Access

如果 V2Board Origin 位于 Cloudflare Access 后面，可以另外配置一对 Worker Secrets：

```text
V2BOARD_ACCESS_CLIENT_ID
V2BOARD_ACCESS_CLIENT_SECRET
```

两项必须同时配置；普通部署不需要它们。

## 当前兼容目标

- V2Board: `wyx2685/v2board`
- Version: `1.7.5.2685.2333`
- Public API: `/api/v1`

完整接口契约见 [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md)。
