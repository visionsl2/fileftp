# 教训记录 — V2.0.x 开发过程

## 主要失误

### 1. 用 `node -e` 写多行文件导致模板错位
- 原因：shell 转义复杂度指数级上升
- 结果：browser.ejs 模板里的 recent-bar、sidebar 丢失
- 教训：用 Edit/Write 工具，不要绕过去写文件

### 2. `git restore` 恢复了没提交的功能
- recent-bar 和 sidebar 是我手写但没 commit 的功能
- 一旦 restore，这些功能直接消失
- 教训：本地改动前先 git commit

### 3. 不浏览器实测
- 只测 API 接口通过就认为完成
- UI 缺失了好几轮都没主动发现
- 教训：改 UI 后必须浏览器访问实际页面

### 4. 不主动告知缺失功能
- 等用户问"为什么没了"才发现
- 应该主动 diff 对比"应该有"vs"实际有"
- 教训：改完做 diff 自查
