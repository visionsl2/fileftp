const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: 'LOGIN_LIMIT_EXCEEDED',
    message: '登录尝试次数过多，请15分钟后再试'
  }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: {
    success: false,
    error: 'REGISTER_LIMIT_EXCEEDED',
    message: '注册过于频繁，请稍后再试'
  }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    success: false,
    error: 'UPLOAD_LIMIT_EXCEEDED',
    message: '上传请求过于频繁'
  }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: {
    success: false,
    error: 'API_RATE_LIMIT_EXCEEDED',
    message: 'API调用频率超限'
  }
});

module.exports = {
  loginLimiter,
  registerLimiter,
  uploadLimiter,
  apiLimiter
};