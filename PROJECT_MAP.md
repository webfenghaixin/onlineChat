# lightChat 项目文档（AI 参考）

> 本文档供 AI 助手快速理解项目全貌，每次会话开始时阅读即可掌握项目结构、文件功能和关键设计。

---

## 1. 项目概览

- **项目名称**：lightChat（online-chat-h5）
- **产品定位**：移动端优先的 AI 聊天 + AI 画图 H5 应用
- **技术栈**：React 18 + Vite 5 + 纯 CSS（无 UI 框架）
- **部署平台**：Vercel（Serverless Functions + 静态托管）
- **数据存储**：localStorage（本地）+ Upstash Redis（云端同步）
- **AI 接口**：通过服务端代理转发至 Luxee / RightCode / Gemini 等上游 API
- **认证方式**：JWT + 邀请码注册

---

## 2. 目录结构总览

```
onlineChat/
├── api/                    # Vercel Serverless Functions（后端 API）
│   ├── auth/               # 认证相关
│   │   ├── login.js        # 登录接口
│   │   └── register.js     # 注册接口
│   ├── data/               # 数据持久化
│   │   ├── load.js         # 加载云端数据
│   │   └── save.js         # 保存数据到云端
│   ├── draw-image/         # 画图图片服务
│   │   └── index.js        # 通过 taskId 返回图片二进制
│   ├── draw-task/          # 异步画图任务
│   │   ├── start.js        # 创建画图任务（异步执行）
│   │   └── status.js       # 查询画图任务状态
│   ├── lib/                # 后端共享工具库
│   │   ├── auth-utils.js   # JWT、密码哈希、Redis 操作、认证中间件
│   │   └── draw-utils.js   # 画图请求构建、图片提取、错误处理
│   ├── draw.js             # 画图代理（直连模式，Node.js runtime）
│   └── proxy.js            # 聊天代理（Edge runtime）
├── docs/                   # 文档
│   └── unicloud-deploy.md  # UniCloud 部署说明（备用方案）
├── functions/              # Cloudflare Pages Functions（备用部署）
│   └── api/
│       ├── draw.js         # Cloudflare 版画图代理
│       └── proxy.js        # Cloudflare 版聊天代理
├── public/                 # 静态资源
│   ├── Logo-备选.png       # 备选 Logo
│   ├── _redirects          # Netlify 重定向规则
│   ├── h5-bg-*.png         # 登录页背景图
│   ├── loading.png         # 加载图
│   └── logo-2.png          # 主 Logo
├── src/                    # 前端源码
│   ├── components/         # UI 组件（按功能拆分）
│   │   ├── AuthForm.jsx    # 登录/注册表单
│   │   ├── AuthLoading.jsx # 登录加载页
│   │   ├── ChatHeader.jsx  # 聊天页头部（含选择模式）
│   │   ├── Composer.jsx    # 聊天输入框（含选择操作栏）
│   │   ├── ConfirmDialog.jsx # 确认弹窗（删除对话/图片）
│   │   ├── DrawPage.jsx    # 画图页面（独立全屏，含侧边栏+消息列表+输入区）
│   │   ├── Drawer.jsx      # 侧边抽屉（对话历史+接口设置）
│   │   ├── MessageRow.jsx  # 聊天消息行（用户/AI，含复制/重试/选择）
│   │   └── Scrollbar.jsx   # 自定义滚动条
│   ├── lib/                # 前端工具库
│   │   ├── auth.js         # 认证 API 调用（login/register/save/load）
│   │   ├── constants.js    # 常量、选项配置、默认设置
│   │   ├── image-utils.js  # 图片压缩处理（参考图预处理）
│   │   ├── stream.js       # 流式聊天 + 画图核心逻辑
│   │   └── utils.js        # 工具函数（markdown、时间格式化、状态管理、内容处理）
│   ├── App.jsx             # 主应用组件（状态管理 + 组件组装）
│   ├── main.jsx            # 入口文件
│   └── styles.css          # 全局样式
├── .env.example            # 环境变量示例
├── .gitignore
├── .vercelignore
├── README.md
├── index.html              # HTML 入口
├── package.json
├── vercel.json             # Vercel 部署配置
└── vite.config.js          # Vite 构建配置 + 本地代理插件
```

---

## 3. 核心架构

### 3.1 前端（src/）

**App.jsx** — 状态管理 + 组件组装，约 1350 行：

- **认证流程**：`auth-form`（登录/注册）→ `loading`（同步云端数据）→ `authenticated`（主界面）
- **聊天模式**：多对话管理，流式输出，支持图片上传，Markdown 渲染，消息选择/删除
- **画图模式**：独立全屏页面，支持文生图/图生图，异步任务轮询，最多保留 20 张图
- **状态持久化**：localStorage 即时保存 + 云端 8 秒防抖同步
- **UI 特性**：自定义滚动条、虚拟键盘适配、移动端安全区适配、字体大小切换

**src/components/** — UI 组件（按功能拆分）：

| 组件 | 功能 |
|------|------|
| `AuthForm` | 登录/注册表单，含邀请码校验 |
| `AuthLoading` | 登录加载页，同步云端数据动画 |
| `ChatHeader` | 聊天页头部，含普通模式和选择模式 |
| `Composer` | 聊天输入框，含图片上传、选择操作栏 |
| `ConfirmDialog` | 通用确认弹窗（删除对话/图片） |
| `DrawPage` | 画图页面，含侧边栏、消息列表、输入区、配置栏 |
| `Drawer` | 侧边抽屉，含对话历史和接口设置两个标签页 |
| `MessageRow` | 聊天消息行，支持复制/重试/选择 |
| `Scrollbar` | 自定义滚动条，支持拖拽和点击定位 |

**src/lib/constants.js** — 常量与选项配置：

| 导出 | 功能 |
|------|------|
| `STORAGE_KEY` / `VITE_INVITE_CODE` / `MAX_COMPOSER_HEIGHT` 等常量 | 全局常量 |
| `FONT_SIZE_OPTIONS` / `MODEL_OPTIONS` / `DRAW_SIZE_OPTIONS` 等 | 下拉选项配置 |
| `defaultSettings` | 默认设置对象 |

**src/lib/utils.js** — 通用工具函数：

| 函数 | 功能 |
|------|------|
| `renderMarkdown()` | Markdown 渲染（带 LRU 缓存） |
| `normalizeModelSettings()` | 模型设置规范化（Gemini 自动切换） |
| `getTextParts()` / `getImageParts()` / `createTextContent()` | 消息内容解析与构建 |
| `createConversation()` / `createDrawConversation()` | 创建新对话 |
| `normalizeState()` / `loadState()` / `saveState()` | 状态持久化 |
| `formatTime()` / `formatDateTime()` / `formatDuration()` | 时间格式化 |
| `buildConversationTitle()` / `buildCopyText()` | 标题和复制文本生成 |
| `classNames()` | CSS 类名拼接 |

**src/lib/image-utils.js** — 图片处理：

| 函数 | 功能 |
|------|------|
| `prepareDrawReferenceImage()` | 参考图压缩（最大 1536px / 1.5MB） |

**src/lib/auth.js** — 认证与数据同步：

| 函数 | 功能 |
|------|------|
| `getToken()` / `setToken()` / `clearToken()` | JWT Token 管理（localStorage） |
| `register()` | 注册并自动保存 token |
| `login()` | 登录并自动保存 token |
| `saveToCloud()` | 保存全部状态到云端 |
| `loadFromCloud()` | 从云端加载状态 |

**src/lib/stream.js** — 聊天和画图的核心请求逻辑：

| 函数 | 功能 |
|------|------|
| `streamChatCompletion()` | 流式聊天请求，支持 SSE / JSON Lines / Gemini 格式解析 |
| `generateImage()` | 画图入口，根据 useProxy 决定走任务 API 还是直连 |
| `pollDrawTask()` | 轮询画图任务状态直到成功/失败 |

关键内部函数：
- `buildRequestBody()` — 构建 OpenAI / Gemini 格式请求体
- `buildGeminiRequestBody()` — Gemini 专用请求体（contents + systemInstruction）
- `extractTextFromEvent()` — 统一提取各种格式（OpenAI/Gemini/Responses API）的文本增量
- `parseSseChunk()` / `parseJsonLinesChunk()` — 流式数据解析
- `extractImageUrlFromPayload()` / `extractImageUrlFromContent()` — 从各种响应格式提取图片 URL

### 3.2 后端 API（api/）

#### 认证模块

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/auth/register` | POST | 注册：验证邀请码 → 生成 salt+hash → 存 Redis → 返回 JWT |
| `/api/auth/login` | POST | 登录：验证密码 hash → 返回 JWT（有效期 30 天） |

#### 数据模块

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/data/save` | POST | 保存用户数据到 Redis（需认证），画图消息智能合并 |
| `/api/data/load` | GET | 加载用户数据（需认证） |

#### 聊天代理

| 路由 | 方法 | Runtime | 功能 |
|------|------|---------|------|
| `/api/proxy` | POST | Edge | 转发聊天请求到上游 API，支持 Luxee/RightCode/Gemini |

代理逻辑：
1. 读取 `X-Source` 头选择上游（luxee/rightcode）
2. 读取 `X-Model` 头判断是否 Gemini 模型
3. Gemini 模型走 `right.codes/gemini` 端点，其他走对应 source 的 chat completions 端点
4. 服务端注入 API Key，流式透传响应

#### 画图模块

| 路由 | 方法 | Runtime | 功能 |
|------|------|---------|------|
| `/api/draw` | POST | Node.js | 直连画图代理（非任务模式），转发到 right.codes/draw |
| `/api/draw-task/start` | POST | Node.js | 创建异步画图任务，立即返回 taskId，后台执行 |
| `/api/draw-task/status` | GET | Node.js | 查询画图任务状态，若 queued/running 则触发执行 |
| `/api/draw-image` | GET | Node.js | 通过 taskId 返回图片二进制（从 Redis 读取 base64） |

画图任务流程：
1. 前端调用 `/api/draw-task/start`，传入 prompt/size/quality/referenceImage/taskMetadata
2. 后端创建 Redis 任务记录（status: queued），用 `waitUntil()` 异步执行 `runTask()`
3. `runTask()` 获取分布式锁 → 调用上游 API → 将图片 base64 存 Redis → 更新任务状态 + 用户数据
4. 前端轮询 `/api/draw-task/status`，获取 imageUrl 或 error
5. 图片 URL 格式：`/api/draw-image?id={taskId}`，从 Redis 读取 base64 返回 PNG

### 3.3 后端工具库（api/lib/）

**auth-utils.js** — 认证与存储基础设施：

| 函数 | 功能 |
|------|------|
| `signJWT()` / `verifyJWT()` | JWT 签发和验证（HS256，Web Crypto API） |
| `hashPassword()` / `generateSalt()` | SHA-256 密码哈希 + UUID salt |
| `createRedis()` | 创建 Upstash Redis 客户端 |
| `getRedisJson()` / `setRedisJson()` / `setRedisJsonNx()` | Redis JSON 读写 |
| `authenticate()` | Edge runtime 请求认证中间件 |
| `jsonResponse()` / `handleOptions()` | 统一响应和 CORS 处理 |

**draw-utils.js** — 画图业务逻辑：

| 函数 | 功能 |
|------|------|
| `runDrawRequest()` | 执行画图请求（Images API / Chat API），返回 base64 或 URL |
| `cleanDrawOptions()` | 清洗和标准化画图参数 |
| `extractImageUrlFromPayload()` | 从各种响应格式提取图片 URL |
| `extractImageBase64FromPayload()` | 从响应提取 base64 图片数据 |
| `normalizeDrawErrorMessage()` | 将上游错误转为用户友好中文提示 |
| `downloadImageAsBase64()` | 下载远程图片并转为 base64 |

---

## 4. 数据模型

### 4.1 Redis 键设计

| Key 模式 | 类型 | TTL | 说明 |
|----------|------|-----|------|
| `user:{username}` | JSON string | 永久 | 用户信息（salt, passwordHash, createdAt） |
| `data:{username}` | JSON string | 永久 | 用户全部数据（conversations, settings, drawConversations 等） |
| `drawTask:{username}:{taskId}` | JSON string | 24h | 画图任务状态（status, imageUrl, error, options, metadata） |
| `drawImage:{taskId}` | string (base64) | 30d | 画图结果图片 base64 |
| `drawTaskLock:{username}:{taskId}` | string | 10min | 画图任务分布式锁 |

### 4.2 前端状态结构

```javascript
{
  settings: {
    source: 'rightcode',         // API 来源
    rightcodePricing: 'regular', // RightCode 计费方式
    endpoint: '',                // 自定义端点
    apiKey: '',                  // 自定义密钥
    model: 'gpt-5.4',           // 模型名
    requestMode: 'chat',        // 请求模式 (chat/gemini)
    systemPrompt: '...',        // 系统提示词
    temperature: 0.7,           // 温度
    maxOutputTokens: 8192,      // 最大输出 token
    stream: true,               // 流式输出
    useProxy: true,             // 使用代理
    proxyPath: '/api/proxy',    // 代理路径
    fontSize: 'lg',             // 字体大小 (md/lg/xl)
    drawSize: '1024x1024',      // 画图尺寸
    drawQuality: 'medium',      // 画图质量
    drawApiMode: 'images',      // 画图 API 模式 (images/chat)
  },
  conversations: [{             // 聊天对话列表
    id, title, updatedAt,
    messages: [{
      id, role, content, createdAt
    }]
  }],
  activeConversationId: '...',
  drawConversations: [{         // 画图对话列表
    id, title, updatedAt,
    messages: [{
      id, role, content, imageUrl, taskId, error,
      referenceImage, size, quality, durationSeconds, createdAt
    }]
  }],
  activeDrawConversationId: '...',
}
```

---

## 5. 环境变量

| 变量名 | 用途 | 使用位置 |
|--------|------|----------|
| `VITE_INVITE_CODE` | 前端注册邀请码校验 | 前端 src/lib/constants.js |
| `VITE_API_TARGET` | 本地开发代理目标地址 | vite.config.js |
| `API_KEY_LUXEE` | Luxee API 密钥 | api/proxy.js, api/draw.js, api/draw-task/start.js |
| `API_KEY_RIGHTCODE` | RightCode API 密钥 | 同上 |
| `INVITE_CODE` | 后端注册邀请码 | api/auth/register.js |
| `JWT_SECRET` | JWT 签名密钥 | api/lib/auth-utils.js |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL | api/lib/auth-utils.js |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis Token | api/lib/auth-utils.js |

---

## 6. 关键设计决策

1. **组件化前端**：App.jsx 约 1350 行（状态管理 + 组件组装），UI 按功能拆分到 src/components/，工具函数拆分到 src/lib/
2. **双模式画图**：代理模式走异步任务 API（start → poll），直连模式走 Images/Chat API
3. **画图图片存储**：base64 存 Redis（30 天 TTL），通过 `/api/draw-image?id=` 返回二进制
4. **画图限制**：最多保留 20 张图，超出自动替换最早的
5. **云端同步策略**：localStorage 即时保存 + 云端 8 秒防抖 + 流式结束后 2 秒立即同步
6. **Gemini 适配**：自动识别 gemini 前缀模型，切换请求格式和端点
7. **双部署方案**：Vercel（主）+ Cloudflare Pages Functions（functions/ 目录，备用）
8. **参考图处理**：前端压缩到最大 1536px / 1.5MB 后上传，保存时移除 base64 减小存储

---

## 7. API 上游端点

| 用途 | 端点 |
|------|------|
| Luxee 聊天 | `https://api.luxee.ai/v1/chat/completions` |
| RightCode 聊天 | `https://www.rightapi.ai/codex-pro/v1/chat/completions` |
| RightCode 日抛 | `https://www.rightapi.ai/codex/v1/responses` |
| Gemini | `https://www.rightapi.ai/gemini/v1beta/models/{model}:streamGenerateContent?alt=sse` |
| 画图 Images API | `https://www.rightapi.ai/draw/v1/images/generations` |
| 画图 Chat API | `https://www.rightapi.ai/draw/v1/chat/completions` |

---

## 8. 可用模型

| 模型 ID | 显示名 | 来源 |
|---------|--------|------|
| gpt-5.6-luna | GPT-5.6-luna | RightCode |
| gpt-5.6-terra | GPT-5.6-terra | RightCode |
| gpt-5.6-sol | GP-5.6-sol | RightCode |
| gemini-3.1-pro | Gemini 3.1 Pro | RightCode/Gemini |
| gpt-image-2 | (画图模型) | RightCode/Draw |

---

## 9. 开发命令

```bash
npm run dev      # 启动开发服务器（含本地代理插件）
npm run build    # 构建生产版本到 dist/
npm run preview  # 预览生产构建
```
