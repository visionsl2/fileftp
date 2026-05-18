/**
 * FileFTP 服务器入口文件
 *
 * 功能说明：
 * - Express应用配置
 * - 中间件注册
 * - 路由配置
 * - 错误处理
 */

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const connectDB = require('./app/config/database');

// 导入路由
const authRoutes = require('./app/routes/authRoutes');
const fileRoutes = require('./app/routes/fileRoutes');
const folderRoutes = require('./app/routes/folderRoutes');
const apiRoutes = require('./app/routes/apiRoutes');

const app = express();

// 连接MongoDB数据库
connectDB();

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});