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
