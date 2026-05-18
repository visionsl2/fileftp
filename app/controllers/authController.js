/**
 * 认证控制器 (Auth Controller)
 *
 * 功能说明：
 * - 处理用户注册、登录、登出
 * - 生成JWT Token用于身份认证
 * - 管理Session和Cookie
 */

const User = require('../models/User');
const authMiddleware = require('../middlewares/authMiddleware');

const authController = {
  /**
   * 用户注册
   *
   * 流程：
   * 1. 验证必填字段
   * 2. 验证两次密码一致
   * 3. 检查用户名/邮箱是否已被注册
   * 4. 创建新用户（密码自动加密）
   * 5. 重定向到登录页
   */
  register: async (req, res) => {
    try {
      const { username, email, password, confirmPassword } = req.body;

      // 验证必填字段
      if (!username || !email || !password) {
        return res.status(400).render('auth/register', {
          title: '注册',
          error: '请填写所有必填字段',
          username,
          email
        });
      }

      // 验证两次密码一致
      if (password !== confirmPassword) {
        return res.status(400).render('auth/register', {
          title: '注册',
          error: '两次密码不一致',
          username,
          email
        });
      }

      // 验证密码长度
      if (password.length < 6) {
        return res.status(400).render('auth/register', {
          title: '注册',
          error: '密码长度至少6位',
          username,
          email
        });
      }

      // 检查用户名/邮箱是否已被注册
      const existingUser = await User.findOne({
        $or: [{ email }, { username }]
      });

      if (existingUser) {
        return res.status(400).render('auth/register', {
          title: '注册',
          error: '用户名或邮箱已被注册',
          username,
          email
        });
      }

      // 创建新用户（密码在User模型的pre-save钩子中自动加密）
      const user = new User({ username, email, password });
      await user.save();

      // 注册成功，跳转到登录页
      res.redirect('/auth/login?registered=true');
    } catch (error) {
      console.error('Register error:', error);
      res.status(500).render('auth/register', {
        title: '注册',
        error: '注册失败，请稍后重试'
      });
    }
  },

  /**
   * 用户登录
   *
   * 流程：
   * 1. 验证必填字段
   * 2. 查找用户并验证密码
   * 3. 检查账号是否被禁用
   * 4. 生成JWT Token
   * 5. 设置Session和Cookie
   * 6. 重定向到文件列表页
   */
  login: async (req, res) => {
    try {
      const { email, password, remember } = req.body;

      // 验证必填字段
      if (!email || !password) {
        return res.status(400).render('auth/login', {
          title: '登录',
          error: '请填写邮箱和密码',
          email
        });
      }

      // 查找用户
      const user = await User.findOne({ email });

      if (!user) {
        return res.status(401).render('auth/login', {
          title: '登录',
          error: '邮箱或密码错误',
          email
        });
      }

      // 检查账号状态
      if (!user.isActive) {
        return res.status(401).render('auth/login', {
          title: '登录',
          error: '账号已被禁用'
        });
      }

      // 验证密码
      const isMatch = await user.comparePassword(password);

      if (!isMatch) {
        return res.status(401).render('auth/login', {
          title: '登录',
          error: '邮箱或密码错误',
          email
        });
      }

      // 更新最后登录时间
      user.lastLogin = new Date();
      await user.save();

      // 生成JWT Token
      const token = authMiddleware.generateToken(user);

      // 设置Session
      req.session.userId = user._id;
      req.session.username = user.username;

      // "记住我"选项 - 延长Cookie有效期
      if (remember) {
        req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
      }

      // 设置Token Cookie（HttpOnly，防止XSS攻击）
      res.cookie('token', token, {
        httpOnly: true,
        maxAge: remember ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
      });

      // 登录成功，跳转到文件列表
      res.redirect('/files');
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).render('auth/login', {
        title: '登录',
        error: '登录失败，请稍后重试'
      });
    }
  },

  /**
   * 用户登出
   *
   * 流程：
   * 1. 销毁Session
   * 2. 清除Token Cookie
   * 3. 重定向到登录页
   */
  logout: (req, res) => {
    req.session.destroy();
    res.clearCookie('token');
    res.redirect('/auth/login');
  },

  /**
   * 渲染登录页面
   */
  getLoginPage: (req, res) => {
    const registered = req.query.registered === 'true';
    res.render('auth/login', {
      title: '登录',
      registered
    });
  },

  /**
   * 渲染注册页面
   */
  getRegisterPage: (req, res) => {
    res.render('auth/register', { title: '注册' });
  }
};

module.exports = authController;