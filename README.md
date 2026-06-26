# lightChat

一个支持 AI 对话与 AI 画图的移动端优先聊天应用，基于 React + Vite 构建，同时支持 H5 网页和 Android 原生壳。

## 功能特性

- AI 对话：流式输出，支持多种模型切换
- AI 画图：支持文生图、图生图，可配置模型 / 尺寸 / 质量
- 历史对话：本地持久化保存，支持管理
- 接口设置：可自定义模型、温度、最大输出等参数
- 移动端优先：适配手机浏览器和 Android 原生，桌面端自适应
- 开发代理：本地开发环境内置同源代理，解决 CORS

## 技术栈

- **前端**：React 18 + Vite 5 + animal-island-ui
- **后端**：Vercel Serverless Functions（Node.js）
- **存储**：Upstash Redis（用户认证、邀请码校验）
- **Android**：Capacitor 8

## 项目结构

```
├── api/                  # Vercel Serverless Functions
│   ├── auth/             # 登录 / 注册
│   ├── data/             # 聊天数据存取
│   ├── draw-image/       # 图片生成
│   ├── draw-task/        # 画图任务（启动 / 轮询）
│   └── proxy.js          # AI 接口代理
├── android/              # Capacitor Android 工程
├── public/               # 静态资源
├── scripts/
│   └── build-android.mjs # Android 构建脚本
├── src/
│   ├── components/       # React 组件
│   ├── lib/              # 工具函数、常量
│   ├── App.jsx
│   ├── main.jsx
│   └── styles.css
├── capacitor.config.json
├── vercel.json
└── vite.config.js
```

## 快速开始

```bash
# 安装依赖
npm install

# 本地开发
npm run dev

# 构建 H5
npm run build
```

## 环境变量

复制 `.env.example` 为 `.env`，按需填写：

| 变量 | 说明 |
|------|------|
| `VITE_INVITE_CODE` | 前端邀请码（注册页校验） |
| `VITE_API_TARGET` | 后端 API 地址（默认 `https://www.lightchat.online`） |
| `API_KEY_LUXEE` | Luxee AI 接口密钥（本地代理用） |
| `API_KEY_RIGHTCODE` | RightCode AI 接口密钥（本地代理用） |
| `INVITE_CODE` | 后端邀请码校验值 |
| `JWT_SECRET` | JWT 签名密钥 |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis 地址 |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis Token |

## 打包 Android

### 前置条件

- 安装 [Android Studio](https://developer.android.com/studio)
- Android SDK 已配置（API 34+）
- JDK 17+

### 构建步骤

```bash
# 1. 构建 Web 资源并同步到 Android 工程（一键完成）
npm run build:android
```

此命令会依次执行：
1. `vite build` — 构建 Web 产物到 `dist/`
2. `cap sync android` — 将 `dist/` 同步到 `android/app/src/main/assets/public/`

如需指定后端地址：

```bash
VITE_API_BASE=https://your-api.example.com npm run build:android
```

### 在 Android Studio 中打包

1. 用 Android Studio 打开 `android/` 目录
2. 等待 Gradle 同步完成
3. 构建 APK：
   - **Debug**：菜单 Build → Build Bundle(s) / APK(s) → Build APK(s)
   - **Release**：菜单 Build → Generate Signed Bundle / APK，按向导签名打包

或使用命令行：

```bash
cd android

# Debug APK → android/app/build/outputs/apk/debug/
gradlew assembleDebug

# Release APK → android/app/build/outputs/apk/release/
gradlew assembleRelease
```

### 更新 Android 应用

当 Web 端有代码更新时，只需重新执行：

```bash
npm run build:android
```

然后在 Android Studio 中重新构建 APK 即可。如果仅修改了 Web 资源（未改原生配置），Capacitor 会自动覆盖 `assets/public/`，无需手动操作。

## 发布 H5 页面

项目使用 [Vercel](https://vercel.com) 部署，配置见 `vercel.json`。

### 方式一：Vercel 自动部署（推荐）

1. 将代码推送到 GitHub 仓库
2. 在 Vercel 控制台导入该仓库
3. Vercel 会自动识别 Vite 项目，执行 `npm run build`，产物输出到 `dist/`
4. 每次推送代码，Vercel 自动重新部署

### 方式二：Vercel CLI 手动部署

```bash
# 安装 Vercel CLI
npm i -g vercel

# 首次部署（按提示选择项目、配置环境变量）
vercel

# 后续部署到生产环境
vercel --prod
```

### 方式三：纯静态部署

```bash
# 构建
npm run build
```

将 `dist/` 目录下的所有文件部署到任意静态服务器（Nginx、COS、OSS 等），注意：

- 需要配置 SPA 回退：所有路径重写到 `index.html`
- 需要配置反向代理 `/api/*` 到后端，或让上游接口开放跨域

### Nginx 配置参考

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/lightchat;
    index index.html;

    # SPA 回退
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理（如需自建后端）
    location /api/ {
        proxy_pass https://www.lightchat.online;
        proxy_http_version 1.1;
        proxy_set_header Host $proxy_host;
        proxy_buffering off;
    }
}
```

## 开发环境 CORS 说明

浏览器不允许网页直接请求第三方接口，本地开发通过 Vite 内置同源代理解决：

1. 浏览器请求 `/api/proxy`
2. Vite 开发服务器将请求转发到页面设置中配置的上游地址
3. 服务端转发无跨域限制

生产环境需二选一：
- 让上游接口开放跨域
- 在自己的服务器配置反向代理

## License

Private
