/**
 * 赛博网盘 服务器入口文件
 *
 * 功能说明：
 * - Express应用配置
 * - 中间件注册
 * - 路由配置
 * - 错误处理
 */

const path = require('path');
const fs = require('fs');

// .env 加载：pkg 打包后从可执行文件同目录加载，开发环境从 cwd 加载
const envPaths = [
  path.join(path.dirname(process.execPath), '.env'),
  path.resolve('.env')
];
let envLoaded = false;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    console.log('[Config] Loaded .env from:', envPath);
    envLoaded = true;
    break;
  }
}
if (!envLoaded) {
  console.log('[Config] No .env file found, using defaults');
}

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const mongoose = require('mongoose');
const connectDB = require('./app/config/database');

// 导入路由
const authRoutes = require('./app/routes/authRoutes');
const fileRoutes = require('./app/routes/fileRoutes');
const folderRoutes = require('./app/routes/folderRoutes');
const apiRoutes = require('./app/routes/apiRoutes');
const shareRoutes = require('./app/routes/shareRoutes');
const adminRoutes = require('./app/routes/adminRoutes');

const app = express();

// 连接MongoDB数据库
const dbConn = connectDB();

// 启动时自动升级老用户的 1GB 默认配额
dbConn.then(async () => {
  if (mongoose.connection.readyState === 1) {
    const User = require('./app/models/User');
    const oldDefault = 1024 * 1024 * 1024; // 旧默认 1GB
    const newDefault = parseInt(process.env.DEFAULT_STORAGE_QUOTA) || 100 * 1024 * 1024 * 1024;
    const result = await User.updateMany(
      { storageQuota: oldDefault },
      { $set: { storageQuota: newDefault } }
    );
    if (result.modifiedCount > 0) {
      console.log(`[Startup] Upgraded ${result.modifiedCount} user(s) quota: 1GB → ${(newDefault/1024/1024/1024).toFixed(0)}GB`);
    }
  }
}).catch(() => {});

// 启动时清理上次上传失败留下的孤儿文件
setTimeout(async () => {
  if (mongoose.connection.readyState === 1) {
    const storageService = require('./app/services/storageService');
    await storageService.cleanOrphanFiles().catch(() => {});
  }
}, 3000);

// ==================== 中间件配置 ====================

// 跨域资源共享
app.use(cors());

// Cookie解析（用于读取token）
app.use(cookieParser());

// JSON请求体解析
app.use(express.json());

// URL编码请求体解析
app.use(express.urlencoded({ extended: true }));

// 静态文件目录
app.use(express.static(path.join(__dirname, 'app/public')));

// Session配置
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,          // 生产环境应设为true
    maxAge: 24 * 60 * 60 * 1000  // 24小时
  }
}));

// ==================== 视图引擎 ====================

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'app/views'));

// ==================== 路由配置 ====================

// 认证路由：登录、注册、登出
app.use('/auth', authRoutes);

// 文件路由：列表、上传、下载、删除
app.use('/files', fileRoutes);

// 文件夹路由：创建、重命名、删除
app.use('/folders', folderRoutes);

// 开放API路由：供第三方系统调用
app.use('/api/v1', apiRoutes);

// 分享路由：无需登录即可访问
app.use('/share', shareRoutes);

// 管理后台：仅管理员可访问
app.use('/admin', adminRoutes);

// ==================== 根路由 ====================

app.get('/', (req, res) => {
  // 已登录用户跳转到文件列表
  if (req.session && req.session.userId) {
    res.redirect('/files');
  } else {
    // 未登录用户跳转到登录页
    res.redirect('/auth/login');
  }
});

// ==================== 错误处理 ====================

// 404页面处理
app.use((req, res) => {
  res.status(404).render('404', { title: '页面未找到' });
});

// 全局错误处理中间件
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'development' ? err.message : '服务器内部错误'
  });
});

// ==================== 启动服务器 ====================

// ==================== 上传超时配置 ====================

// 文件上传路由需要较长超时（大视频可能耗时数分钟）
app.use('/files/upload', (req, res, next) => {
  req.setTimeout(120 * 60 * 1000);  // 2小时上传超时
  res.setTimeout(120 * 60 * 1000);
  next();
});

// ==================== 启动服务器 ====================

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
server.timeout = 120 * 60 * 1000;  // 全局 10 分钟超时
server.headersTimeout = 120 * 60 * 1000 + 1000;
server.keepAliveTimeout = 120 * 60 * 1000 + 1000;