/**
 * 认证中间件 (Auth Middleware)
 *
 * 功能说明：
 * - JWT Token生成和验证
 * - 多方式认证支持（Bearer Token、Cookie、Session）
 * - 用户信息注入到req对象
 *
 * 认证优先级：
 * 1. Authorization Header (Bearer Token)
 * 2. Cookie (token)
 * 3. Session (session.userId)
 */

const jwt = require('jsonwebtoken');
const authConfig = require('../config/auth');
const User = require('../models/User');

const authMiddleware = {
  /**
   * 生成JWT Token
   * @param {Object} user - 用户对象
   * @returns {string} JWT Token
   */
  generateToken: (user) => {
    return jwt.sign(
      { userId: user._id, username: user.username },
      authConfig.JWT_SECRET,
      { expiresIn: authConfig.JWT_EXPIRES_IN }
    );
  },

  /**
   * 验证Token中间件
   *
   * 支持三种认证方式，按顺序尝试：
   * 1. Authorization Header中的Bearer Token
   * 2. Cookie中的token
   * 3. Session中的userId
   *
   * 验证成功后：
   * - req.user = 用户对象
   * - req.userId = 用户ID
   */
  verifyToken: async (req, res, next) => {
    try {
      let token = null;

      // 方式1：从Authorization Header获取
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
      // 方式2：从Cookie获取
      else if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
      }
      // 方式3：从Session获取
      else if (req.session && req.session.userId) {
        const user = await User.findById(req.session.userId);
        if (user && user.isActive) {
          req.user = user;
          req.userId = user._id;
          return next();
        }
      }

      // 没有Token
      if (!token) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(401).json({
            success: false,
            message: '未提供认证令牌'
          });
        }
        return res.redirect('/auth/login');
      }

      // 验证JWT Token
      const decoded = jwt.verify(token, authConfig.JWT_SECRET);
      const user = await User.findById(decoded.userId);

      if (!user || !user.isActive) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(401).json({
            success: false,
            message: '用户不存在或已被禁用'
          });
        }
        return res.redirect('/auth/login');
      }

      // 注入用户信息
      req.user = user;
      req.userId = user._id;
      next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(401).json({
            success: false,
            message: '令牌已过期'
          });
        }
        return res.redirect('/auth/login');
      }
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({
          success: false,
          message: '无效的认证令牌'
        });
      }
      return res.redirect('/auth/login');
    }
  },

  /**
   * 可选认证中间件
   *
   * 不强制要求登录，用于需要认证但非强制的场景
   * 如果有Token则验证并注入用户信息，否则继续
   */
  optionalAuth: async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, authConfig.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (user && user.isActive) {
          req.user = user;
          req.userId = user._id;
        }
      }
      next();
    } catch {
      next();
    }
  }
};

module.exports = authMiddleware;