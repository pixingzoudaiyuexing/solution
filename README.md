# solution

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pixingzoudaiyuexing/solution)

## 一键部署

点击上方 **Deploy to Cloudflare**，登录 Cloudflare 后按页面提示填写部署配置并完成部署。

部署完成后，Cloudflare 会分配 `workers.dev` 地址；也可以在 Cloudflare Dashboard 中绑定自定义域名。

## 手动部署

需要 Node.js 和 npm。

```bash
npm ci
npx wrangler login
cp .dev.vars.example .dev.vars
```

编辑 `.dev.vars`，填写部署所需配置，然后执行：

```bash
npx wrangler secret bulk .dev.vars
npm run deploy
```

`.dev.vars` 已被 `.gitignore` 忽略，请勿将真实配置提交到 Git。
