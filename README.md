# FileFTP - 文件上传下载浏览系统

基于 Node.js + Express + MongoDB 的文件管理系统。

## 功能特性

- 用户注册/登录
- 文件上传（支持多文件上传、进度条显示）
- 文件下载
- 仿Windows文件浏览器
- 文件夹管理（创建、重命名、删除）
- 数据隔离（用户只能访问自己的文件）
- 安全过滤（禁止上传脚本类文件）
- 开放API（供其他系统调用）

## 安装

```bash
npm install
```

## 配置

复制 `.env.example` 为 `.env` 并修改配置：

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/fileftp
JWT_SECRET=your-secret-key
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=104857600
```

## 启动

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```

## 禁止上传的文件类型

以下扩展名的文件禁止上传：

`.js, .ts, .py, .php, .asp, .jsp, .rb, .sh, .bat, .exe, .dll, .vbs` 等

## 开放API

### 获取API Token

```bash
POST /api/v1/auth/token
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password"
}
```

### 上传文件

```bash
POST /api/v1/files/upload
X-API-Token: your-api-token
Content-Type: multipart/form-data

file: (binary)
```

### 获取文件列表

```bash
GET /api/v1/files
X-API-Token: your-api-token

# 可选参数
?folder=folderId
?page=1
?limit=20
```

### 下载文件

```bash
GET /api/v1/files/:id/download
X-API-Token: your-api-token
```

### 删除文件

```bash
DELETE /api/v1/files/:id
X-API-Token: your-api-token
```

## Web端路由

| 路由 | 说明 |
|------|------|
| GET /auth/login | 登录页 |
| GET /auth/register | 注册页 |
| GET /files | 文件浏览器 |
| GET /files/:id/download | 下载文件 |

## 项目结构

```
fileftp/
├── app/
│   ├── controllers/    # 控制器
│   ├── models/         # 数据模型
│   ├── routes/         # 路由
│   ├── middlewares/    # 中间件
│   ├── services/       # 服务
│   ├── utils/          # 工具
│   ├── views/         # 视图模板
│   ├── public/         # 静态资源
│   └── config/         # 配置
├── uploads/           # 上传目录
├── server.js          # 入口文件
├── package.json
└── .env
```