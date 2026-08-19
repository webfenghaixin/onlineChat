# PC与H5代码拆分改动文档

> 方案B：彻底拆分PC端与H5端为两套独立代码，同时补齐PC端缺失功能

---

## 一、架构决策说明

### 1.1 现状问题
当前项目存在"混合架构"问题：
- **聊天模块**：PC/H5已是双份独立实现，但PC版功能严重缩水（缺停止生成、复制/重试、全屏编辑、多选删除等4项核心功能）
- **制图模块**：仅`DrawPage.jsx`一套代码共用，靠3处`isDesktop` className切换，PC端视觉仍是phone-shell风格
- **样式妥协**：使用`!important`强制覆盖（[styles.css L5624-5625](file:///f:/my-project/onlineChat/src/styles.css#L5624-L5625)）、CSS媒体查询+JS flag双重冗余触发

### 1.2 选择方案B的理由
- 一套代码适配两端导致"两头不讨好"：H5想紧凑、PC想展开，相互妥协
- 彻底拆分后，PC和H5可各自独立优化，互不影响
- 代码量增大但边界清晰，长期维护成本更低
- PC端有空间补齐缺失的4项功能

---

## 二、新目录结构

```
src/
├── components/
│   ├── shared/                      # 跨端复用组件
│   │   ├── AuthForm.jsx
│   │   ├── AuthLoading.jsx
│   │   ├── ConfirmDialog.jsx
│   │   ├── RechargeDialog.jsx
│   │   ├── ImagePreview.jsx
│   │   ├── FullscreenEditor.jsx
│   │   └── Scrollbar.jsx
│   │
│   ├── mobile/                      # H5端组件
│   │   ├── index.jsx                # H5主视图入口
│   │   ├── DrawPage.jsx             # H5制图页（删除isDesktop）
│   │   ├── ChatHeader.jsx
│   │   ├── Composer.jsx
│   │   ├── MessageRow.jsx
│   │   ├── Drawer.jsx
│   │   └── BalanceBar.jsx
│   │
│   └── desktop/                     # PC端组件
│       ├── index.jsx                # PC主视图入口
│       ├── ChatHeader.jsx           # 补selectMode
│       ├── Composer.jsx             # 补停止/全屏/pendingImages
│       ├── MessageRow.jsx           # 补复制/重试
│       ├── Drawer.jsx               # 补完整设置
│       ├── DrawPage.jsx             # PC独立制图页
│       ├── DrawSidebar.jsx          # PC持久化侧栏
│       ├── DrawComposer.jsx         # PC制图输入区
│       └── ThemeSwitch.jsx          # 主题切换
│
├── pages/
│   └── index.jsx                    # 设备判断+渲染对应端index
├── hooks/                           # 共享（不变）
├── lib/                             # 共享（不变）
├── themes/                          # 主题样式
│   ├── animal.css                   # 动森主题变量
│   └── dark.css                     # 暗黑主题变量
└── styles.css                       # 全局reset+非主题样式
```

---

## 三、文件迁移清单

### 3.1 迁移到 shared/（7个，跨端完全一致）
| 源路径 | 目标路径 |
|--------|---------|
| `src/components/AuthForm.jsx` | `src/components/shared/AuthForm.jsx` |
| `src/components/AuthLoading.jsx` | `src/components/shared/AuthLoading.jsx` |
| `src/components/ConfirmDialog.jsx` | `src/components/shared/ConfirmDialog.jsx` |
| `src/components/RechargeDialog.jsx` | `src/components/shared/RechargeDialog.jsx` |
| `src/components/ImagePreview.jsx` | `src/components/shared/ImagePreview.jsx` |
| `src/components/FullscreenEditor.jsx` | `src/components/shared/FullscreenEditor.jsx` |
| `src/components/Scrollbar.jsx` | `src/components/shared/Scrollbar.jsx` |

### 3.2 迁移到 mobile/（6个，保留现有实现）
| 源路径 | 目标路径 | 操作 |
|--------|---------|------|
| `src/components/DrawPage.jsx` | `src/components/mobile/DrawPage.jsx` | 移动+删除isDesktop prop |
| `src/components/ChatHeader.jsx` | `src/components/mobile/ChatHeader.jsx` | 移动 |
| `src/components/Composer.jsx` | `src/components/mobile/Composer.jsx` | 移动 |
| `src/components/MessageRow.jsx` | `src/components/mobile/MessageRow.jsx` | 移动 |
| `src/components/Drawer.jsx` | `src/components/mobile/Drawer.jsx` | 移动 |
| `src/components/BalanceBar.jsx` | `src/components/mobile/BalanceBar.jsx` | 移动 |

### 3.3 删除文件
- `src/components/DesktopView.jsx`（功能拆分到desktop/下）

### 3.4 新建文件（13个）
- `src/components/mobile/index.jsx`（H5主视图入口）
- `src/components/desktop/index.jsx`（PC主视图入口）
- `src/components/desktop/ChatHeader.jsx`
- `src/components/desktop/Composer.jsx`
- `src/components/desktop/MessageRow.jsx`
- `src/components/desktop/Drawer.jsx`
- `src/components/desktop/DrawPage.jsx`
- `src/components/desktop/DrawSidebar.jsx`
- `src/components/desktop/DrawComposer.jsx`
- `src/components/desktop/ThemeSwitch.jsx`
- `src/themes/animal.css`
- `src/themes/dark.css`
- `src/lib/theme-utils.js`

---

## 四、PC功能补齐清单

### 4.1 必补4项（用户要求）
| # | 功能 | 实现位置 | 说明 |
|---|------|---------|------|
| 1 | 停止生成按钮 | `desktop/Composer.jsx` | 调用stopStreaming中断流式 |
| 2 | 消息复制/重试 | `desktop/MessageRow.jsx` | 单条消息复制、重新生成 |
| 3 | 全屏编辑器 | `desktop/Composer.jsx` | 集成FullscreenEditor |
| 4 | 多选删除模式 | `desktop/ChatHeader.jsx` + `desktop/Composer.jsx` | selectMode入口+操作栏 |

### 4.2 延伸补齐（顺带补全）
| # | 功能 | 实现位置 | 说明 |
|---|------|---------|------|
| 5 | pendingImages预览 | `desktop/Composer.jsx` | 上传图片缩略图行 |
| 6 | onPaste处理 | `desktop/Composer.jsx` | 粘贴图片支持 |
| 7 | 侧栏完整设置 | `desktop/Drawer.jsx` | 模型/温度/maxTokens/systemPrompt/改密码 |
| 8 | 历史会话messageCount | `desktop/Drawer.jsx` | 显示对话消息数 |

---

## 五、主题切换实现说明

### 5.1 技术方案
- CSS变量+data-theme属性切换
- 主题状态存入settings对象（复用useCloudSync同步）
- 不新建独立hook，直接在index.jsx应用

### 5.2 文件结构
- `src/themes/animal.css`：动森主题变量（从styles.css L2576-2601抽出）
- `src/themes/dark.css`：暗黑主题变量（色值待参考图定稿，先放占位）
- `src/lib/theme-utils.js`：applyTheme/getStoredTheme工具函数
- `src/components/desktop/ThemeSwitch.jsx`：切换按钮

### 5.3 状态管理
- `settings.theme` 字段，默认值`'animal'`
- 老用户settings无此字段时回退默认
- 在`src/pages/index.jsx`读取并应用`data-theme`属性到`document.documentElement`

---

## 六、实施顺序

### 阶段1：创建改动文档（本文档）
### 阶段2：目录迁移（创建shared/mobile/desktop/themes，移动文件，更新import）
### 阶段3：PC聊天模块补齐（抽desktop/ChatHeader、Composer、MessageRow、Drawer，补齐4+功能）
### 阶段4：PC制图页独立实现（新建desktop/DrawPage、DrawSidebar、DrawComposer）
### 阶段5：主题切换基础设施（themes/animal.css、dark.css、ThemeSwitch、settings.theme）
### 阶段6：清理styles.css冗余+验证

---

## 七、风险与回滚

### 7.1 风险
| 风险 | 规避措施 |
|------|---------|
| 文件迁移import遗漏 | 每阶段后npm run build + Grep全局搜索旧路径 |
| PC新组件props不一致 | 以mobile/组件props为准对齐 |
| DesktopView删除后状态传递断裂 | 保持index.jsx→desktop/index.jsx props透传链不变 |
| animal-island-ui暗黑主题不适配 | 主题切换阶段单独处理组件库覆盖样式 |

### 7.2 回滚
- 每阶段完成后git commit，出现问题可回退到上一阶段
- 阶段2迁移前先commit一次"迁移前快照"

---

## 八、验证标准

- [ ] npm run build 无报错
- [ ] PC端聊天：发送、停止生成、复制、重试、全屏编辑、多选删除
- [ ] PC端制图：生成、参数配置、参考图、历史切换、下载
- [ ] H5端聊天：所有原有功能无回归
- [ ] H5端制图：所有原有功能无回归
- [ ] 主题切换：动森↔暗黑切换正常，刷新保持
- [ ] 561px断点：窗口缩放正确切换PC/H5
- [ ] 无`!important`强制覆盖
- [ ] 无CSS媒体查询+JS flag双重冗余
- [ ] shared/组件确实双端复用
- [ ] mobile/和desktop/无交叉引用
