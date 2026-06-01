# UniCloud 部署说明

## 适合这个项目的部署方式

推荐使用同一个 `uniCloud` 服务空间完成两部分：

1. `前端网页托管`：上传 `dist` 目录里的静态页面
2. `云函数 URL 化`：创建一个 `chatProxy` 云函数，专门转发 AI 请求

这样前端不会直接请求第三方 AI 接口，而是请求你自己的 UniCloud 代理函数。

## 项目默认值

当前前端默认已经改成：

- 请求地址：`https://api.luxee.ai/v1/chat/completions`
- 模型：`gpt5.4`
- 代理：默认开启

你上线 UniCloud 后，建议把页面里的“代理地址”改成你的 UniCloud 代理函数 URL。

## 第一步：部署前端网页

先本地打包：

```bash
npm install
npm run build
```

然后登录 uniCloud 控制台，进入你的服务空间，打开 `前端网页托管`，上传整个 `dist` 目录内容。

官方文档：

- 前端网页托管：[uniCloud 官方文档](https://doc.dcloud.net.cn/uniCloud/hosting.html)

根据官方文档，`前端网页托管`支持上传 `html`、`js`、`css`、图片等静态资源，适合这类前后端分离站点。

## 第二步：部署代理云函数

我已经在项目里给你放好了示例函数：

- [chatProxy/index.js](F:\my-project\onlineChat\unicloud\cloudfunctions\chatProxy\index.js)
- [chatProxy/package.json](F:\my-project\onlineChat\unicloud\cloudfunctions\chatProxy\package.json)

把这个云函数部署到 UniCloud 后，给它配置 URL 化访问路径，比如：

```text
/chat-proxy
```

官方文档：

- 云函数 URL 化：[uniCloud 官方文档](https://doc.dcloud.net.cn/uniCloud/http)

根据官方文档，云函数配置某个 path 后，HTTP 访问这个 path 会执行对应云函数。

## 第三步：前端里填写代理地址

部署完成后，前端设置里这样填：

- 请求地址：`https://api.luxee.ai/v1/chat/completions`
- 模型名：`gpt5.4`
- 通过代理请求：开启
- 代理地址：填你的 UniCloud 云函数 URL

例如：

```text
https://你的云函数域名/chat-proxy
```

## 第四步：处理跨域

这里有两种情况：

1. 如果前端托管页面和云函数访问已经在 UniCloud 默认允许范围内，通常可以直接访问
2. 如果你用了自定义域名，或者前端域名和云函数域名不同，需要在服务空间的 `跨域配置` 里把前端域名加入 `Web 安全域名`

官方文档说明：

- `localhost` 和前端托管默认域名，请求云函数时默认支持
- 如果使用自定义域名，需要在 `跨域配置` 中额外添加

参考来源：

- 前端托管跨域说明：[uniCloud 官方文档](https://doc.dcloud.net.cn/uniCloud/hosting.html)

## 推荐上线方式

最稳妥的是：

1. 前端网页托管绑定自己的正式域名
2. 云函数 URL 化也绑定自己的自定义域名，或者至少确认它可稳定访问
3. 在 UniCloud `跨域配置` 中加入你的前端正式域名

## 补充说明

这个 `chatProxy` 示例函数目前是普通转发，适合先跑通。

如果你后面要进一步增强，我建议再做这几项：

- 把真实 API Key 固定保存在云函数环境里，不让前端直接暴露密钥
- 在云函数里固定允许访问的上游域名，避免被滥用
- 针对流式输出做更完整的透传优化
- 增加调用频率限制和日志记录
