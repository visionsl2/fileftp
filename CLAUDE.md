# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

```bash
npm run dev          # 开发模式（nodemon 热重载）
npm start            # 生产模式（需先 npm run build）
npm run pkg          # pkg 打包 Windows 可执行文件 → dist/fileftp-win.exe
node server.js       # 直接启动（推荐开发用）
```

**打包注意事项**：sharp/ffmpeg 原生模块无法打包进 exe，代码已做可选依赖降级。发布时需附带 `.env` 与 exe 同目录。

## Architecture

### 认证流程

三重认证优先级：`Authorization: Bearer <token>` → `Cookie: token` → `Session.userId`。

Web 端使用 **HttpOnly Cookie** 自动携带 token（JS 无法读取，避免 XSS）。API 端使用 `X-API-Token` Header。`app/middlewares/authMiddleware.js` 的 `verifyToken` 同时处理三种方式，验证后注入 `req.userId` / `req.user`。

### 文件存储路径体系

**核心原则**：数据库只存**相对于 `UPLOAD_DIR` 的相对路径**，读取时用 `storageService.resolvePath()` 拼接还原。

- `storage.relativePath` — 存入 DB 的相对路径（如 `userId/folderId/timestamp_hash.jpg`）
- `storage.path` — 上传时的临时绝对路径，仅用于本地文件操作，**不能存入 DB**
- `storageService.resolvePath(storedPath)` — 读取时还原绝对路径，自动兼容旧数据（绝对路径直接返回）

**迁移兼容**：`resolvePath()` 同时支持绝对和相对路径，`path.isAbsolute()` 判断。旧数据升级无需迁移。

### 上传流程 (formidable v2)

`fileController.uploadFiles()` 中手动通过 `form.on('file', ...)` 事件收集文件。这是因为 formidable v2 的 `form.parse()` 回调中多文件时只返回单个对象而非数组。

流程：`form.on('file')` 收集 → `form.parse()` 解析 fields → 过滤被阻止的文件类型 → 检查存储配额 → `storageService.processUploadedFile()` 移动文件 → 创建 DB 记录 → **触发缩略图 + AI 分析 → 自动归类**。

`req.on('aborted')` / code 1002 已正确处理（客户端取消时静默忽略）。

### AI 分析双引擎

`app/services/aiService.js` 提供两个分析路径，通过 `.env` 的 `AI_PROVIDER` 切换：

- **`AI_PROVIDER` 未设置**：本地 TensorFlow.js MobileNet（纯 CPU，离线，1000 类物体识别）
- **`AI_PROVIDER=openai` + `AI_API_KEY`**：云端多模态大模型（OpenAI 兼容 API，支持 GPT-4V / Claude / MiniMax / Ollama 等）

视频分析：ffmpeg `execSync` 提取中间帧 → 转 base64 → 发给 LLM。

分析结果写入 `File.aiAnalysis`：labels/category/summary/objects/scene/text/model/promptTokens/completionTokens/totalTokens。

### 自动归类 + 重命名

`fileController.autoOrganizeFile()` 在 AI 分析后自动执行：
1. 根据 category/labels 创建层级文件夹（`风景/海边`）
2. 纯字母/数字文件名自动替换为 AI 摘要
3. 移动文件到目标文件夹

由 `AI_AUTO_ORGANIZE=true` 控制开关。

### Token 配额体系

`fileController.checkAiQuota()` 统计 `File.aiAnalysis.analyzedAt` 本月记录数。`admin` 角色无限制，普通用户受 `AI_MONTHLY_LIMIT`（默认 20）限制，每月 1 号自然月重置。管理后台 `/admin` 查看全局 Token 输入/输出统计（来自 API `usage` 字段）。

### 数据库连接

`app/config/database.js` — MongoDB 连接失败**不终止进程**（返回 `null`），服务降级运行。sharp/ffmpeg 同理，加载失败仅跳过相关功能。

### .env 加载 (pkg 兼容)

`server.js` 优先从 `process.execPath` 目录加载 `.env`，fallback 到 `cwd`。确保 pkg 打包后 exe 同目录的 `.env` 优先被读取。

### Service 层

| 文件 | 职责 |
|------|------|
| `storageService.js` | 文件存取、缩略图生成（sharp/ffmpeg）、路径解析、分片合并 |
| `aiService.js` | 双引擎 AI 分析、视频帧提取、LLM API 调用、JSON 响应解析 |

### 关键 .env 配置项

```ini
UPLOAD_DIR=./uploads          # 存储根目录（支持绝对/相对路径）
FFMPEG_PATH=                  # ffmpeg 路径（视频缩略图/分析需要）
AI_PROVIDER=openai            # 启用云端大模型
AI_AUTO_CLASSIFY=true         # 上传后自动 AI 分析
AI_AUTO_ORGANIZE=true         # 自动归类+重命名
AI_MONTHLY_LIMIT=20           # 普通用户月分析上限
```

---

## 性能优化经验（V2.0.2 → V2.0.3 实战总结）

> 凡是"列表/网格/缩略图"功能，开发时必须考虑这些点。每条都是踩过的坑。

### 0. 部署后强制刷新浏览器缓存（2026-07-07 教训）
- **问题**：部署新版 JS/CSS 后，浏览器仍加载旧版本（用户强刷也不一定生效）
- **解决**：HTML 中引用静态资源时加版本号 query string
  - `<link rel="stylesheet" href="/css/filebrowser.css?v=20260707-1">`
  - `<script src="/js/filebrowser.js?v=20260707-1"></script>`
- **流程**：每次部署前手动 bump 版本号（递增或用日期）
- **好处**：用户普通刷新即可拿到新资源，无需 Ctrl+Shift+R 强刷

### 1. 后端：字段过滤

```javascript
const fileFields = 'originalName extension mimeType size folder updatedAt thumb';
File.find({...}).select(fileFields).lean()
```

**要点**：永远不要 `.find()` 不带 select 返回全字段。File 表有 `storage.path`、`aiAnalysis`（含 tokens 统计等）、`__v`、`createdAt` 等，前端不需要。Mongoose 默认带全字段，每次响应浪费几十 KB。`.lean()` 返回纯对象更快。

### 2. 后端：HTTP 缓存头

```javascript
res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
res.setHeader('ETag', '"' + file._id.toString() + '"');
if (req.headers['if-none-match'] === '"' + file._id.toString() + '"') {
  return res.status(304).end();
}
```

- 静态资源（缩略图、原图、视频流）必须带 `Cache-Control`
- `immutable` 表示"永不变化"，浏览器更激进缓存
- 用 ETag 做 304 协商：客户端带 `If-None-Match` → 服务端只返回 0 字节的 304
- 用 `file._id` 作为 ETag 天然唯一且稳定

### 3. 前端：`<img>` 必须有 width/height

```html
<img src="/thumb" width="180" height="180" loading="lazy" decoding="async">
```

**没有 width/height 是最大坑**：浏览器解析 HTML 时 `<img>` 占 0×0，图片下载完后才知道真实尺寸 → 触发 reflow。60+ 张图片依次加载 → 反复 layout → 卡顿。固定尺寸后浏览器提前预留位置，不触发 reflow。

`decoding="async"` 让浏览器异步解码图片，主线程不阻塞。

### 4. 前端：事件委托替代逐个绑定

```javascript
// ❌ 错：50 个文件 = 250 个监听器，每次滚动加载更多都翻倍
document.querySelectorAll('.file-checkbox').forEach(cb => cb.addEventListener('change', ...))

// ✅ 对：1 个监听器，永远不增长
fileList.addEventListener('change', (e) => {
  const cb = e.target.closest('.file-checkbox');
  if (cb) { ... }
})
```

**经验法则**：
- 列表项超过 10 个 → 必须用事件委托
- 父元素绑一次，子元素用 `e.target.closest()` 匹配
- 加载更多内容时**不要**重新绑定（委托后子元素自动生效）

### 5. 前端：CSS `will-change` 慎用

```css
/* ❌ 错：60 个 item 全预分配 GPU 层，首屏卡 */
.file-item { will-change: transform; }

/* ✅ 对：只在 hover 时启用 */
.file-item:hover { will-change: transform; }
```

`will-change` 提示浏览器为元素创建独立 GPU 层。**静态加在大量元素上 = 显存爆炸 + 首屏渲染慢**。只在即将发生动画的元素上用，hover 完浏览器自动清理。

### 6. 前端：避免 `transition: all`

```css
/* ❌ 监听所有 CSS 属性变化，性能差 */
.btn { transition: all 0.2s; }

/* ✅ 只监听真正变化的属性 */
.btn { transition: background-color 0.2s, color 0.2s; }
```

`transition: all` 让浏览器持续监听每个 CSS 属性（color、padding、border、shadow、transform 等），每改一个就触发过渡。明确列出属性才能精确控制。

### 7. 前端：避免 `opacity: 0` 占空间 + GPU 合成

```css
/* ❌ 用 opacity:0 占布局且仍参与 GPU 合成 */
.file-actions { opacity: 0; }

/* ✅ 用 visibility:hidden 完全退出合成 */
.file-actions { visibility: hidden; opacity: 0; }
```

`opacity: 0` 元素仍在 GPU 合成层中（因为可能动画到 opacity 1），参与每帧合成计算。`visibility: hidden` 完全退出合成。

### 8. 前端：避免无限循环动画

```css
/* ❌ 60 个徽标全部 pulse animation：GPU 满载 */
.ai-pending-badge { animation: pulse 1.5s infinite; }
```

CSS animation 即使不 hover 也在持续运转。几十个徽标同时跑 = GPU 永远闲不下来。

### 9. 前端：滚动加载用 IntersectionObserver

```javascript
const observer = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) loadMore();
}, { rootMargin: '200px' });
observer.observe(sentinel);
```

比 `scroll` 事件 + getBoundingClientRect 性能好得多，浏览器原生优化。

### 10. 前端：相同接口只请求一次

```javascript
// 用 _cachedFolders 缓存数据，移动弹窗和侧边栏共用同一份 fetch 结果
async ensureFolderTreeData() {
  if (this._cachedFolders) return this._cachedFolders;
  // ...fetch...
}
```

### 11. 前端：并发请求错开

```javascript
// ❌ 12 张图同时 ai-status 请求：服务器压力 + 网络拥塞
await Promise.all([...items].map(checkOne))

// ✅ 错开 150ms：服务器有缓冲，前端不会卡
items.forEach((item, i) => setTimeout(() => checkOne(item), i * 150))
```

### 12. nginx：上传/大文件配置

```nginx
client_max_body_size 0;           # 不限上传大小
proxy_request_buffering off;     # 流式，不缓冲
proxy_read_timeout 7200s;         # 2小时超时
proxy_send_timeout 7200s;
```

---

## 性能优化检查清单（开发任何列表功能前自查）

- [ ] 后端 `.select()` 指定字段，不返回 `storage.path` 等
- [ ] 后端响应带 `Cache-Control` + `ETag` + 304 支持
- [ ] 所有 `<img>` 有 `width` + `height` + `loading="lazy"` + `decoding="async"`
- [ ] 列表项 > 10 个 → 用事件委托到父元素
- [ ] 不在大量元素上用 `will-change`
- [ ] CSS `transition` 写具体属性，不要 `all`
- [ ] 不用 `opacity: 0` 隐藏元素（除非必须动画）
- [ ] 不在静态元素上用 CSS `animation: ... infinite`
- [ ] 滚动加载用 `IntersectionObserver`
- [ ] 同接口并发请求做错开（150ms 间隔）
- [ ] nginx 配 `client_max_body_size 0` + `proxy_request_buffering off`

---

## 教训（V2.0.x 反复犯过的错）

1. **`git restore` 会丢未提交的功能** — 任何手动改动前先 `git commit`
2. **用 `node -e` 写多行文件是高风险操作** — shell 转义复杂度指数级上升
3. **改 UI 后必须浏览器实测** — API 通过 ≠ UI 正确
4. **`rebindFileActions()` 是监听器泄漏根源** — 永远不要重新绑 DOM 监听器
5. **后端返回全字段是隐性性能问题** — 默认行为不优化，需要明确 `.select()`
6. **改 .env 前要看清楚是本地还是生产** — 覆盖生产 `.env` 是个大坑
