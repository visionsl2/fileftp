const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authConfig = require('../config/auth');

const verifyApiToken = async (req, res, next) => {
  try {
    let token = req.headers['x-api-token'] || req.headers['authorization'];

    if (token && token.startsWith('Bearer ')) {
      token = token.substring(7);
    }

    if (!token) {
      token = req.query.api_token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'API_TOKEN_REQUIRED',
        message: '请提供API访问令牌'
      });
    }

    const decoded = jwt.verify(token, authConfig.JWT_SECRET);

    const user = await User.findOne({
      apiToken: token,
      isActive: true
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_API_TOKEN',
        message: '无效的API令牌'
      });
    }

    if (user.apiTokenExpires && user.apiTokenExpires < new Date()) {
      return res.status(401).json({
        success: false,
        error: 'API_TOKEN_EXPIRED',
        message: 'API令牌已过期，请重新生成'
      });
    }

    req.apiUser = user;
    req.userId = user._id;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'INVALID_TOKEN',
        message: '令牌格式错误'
      });
    }
    return res.status(500).json({
      success: false,
      error: 'AUTH_ERROR',
      message: '认证服务错误'
    });
  }
};

module.exports = { verifyApiToken };