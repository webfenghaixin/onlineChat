# 在线 AI 聊天 H5

这是一个适合手机浏览器使用的 React 聊天项目，支持：

- 大字号和更大的按钮，适合老人使用
- 流式输出
- 历史对话本地保存
- 可切换 OpenAI Chat Completions / Responses 兼容模式
- 开发环境同源代理，解决本地调试时的 CORS

## 开发环境如何解决 CORS

浏览器不允许网页直接绕过第三方接口的跨域限制，所以开发环境默认开启了同源代理：

- 前端实际请求：`/api/proxy`
- 真实上游地址：在页面设置里的“请求地址”填写
- 真实密钥：在页面设置里的“密钥”填写

也就是说：

1. 浏览器只请求当前站点自己的 `/api/proxy`
2. Vite 本地开发服务收到请求后，再从服务端转发到真实接口
3. 这样浏览器不会再因为跨域而拦截

## 生产环境部署说明

如果您最终只是把 `dist/index.html` 和静态资源直接丢到纯静态服务器上，而服务器没有反向代理能力，那么：

- 前端直接请求第三方接口时，仍然可能遇到 CORS
- 这不是前端代码本身能单独解决的

生产环境需要二选一：

1. 让上游接口服务器开放您的站点域名跨域
2. 在您自己的服务器上配置反向代理，把例如 `/api/proxy` 转发到真实 AI 接口

## Nginx 反向代理示例

如果您的正式站点使用 Nginx，可以参考下面思路：

```nginx
location /api/proxy {
    proxy_pass https://right.codes/codex-pro/gpt-5.4-medium;
    proxy_http_version 1.1;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Content-Type application/json;
    proxy_buffering off;
    chunked_transfer_encoding on;
}
```

如果您想保留“页面里自定义任意上游地址”的能力，那么正式环境更适合单独做一个后端代理接口，而不是纯 Nginx 固定转发。

## 使用方式

```bash
npm install
npm run dev
npm run build
```

构建产物在：

- `dist/index.html`
- `dist/assets/*`
