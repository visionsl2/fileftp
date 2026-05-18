/**
 * 用户模型 (User Model)
 *
 * 功能说明：
 * - 存储用户账户信息（用户名、邮箱、密码）
 * - 支持API Token认证，供第三方系统调用
 * - 管理用户存储配额和使用量
 *
 * 密码加密：使用bcryptjs进行加密存储，确保安全性
 * API Token：用于开放API认证，每个用户可独立生成
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  // 用户名 - 唯一标识，用于登录
  username: {
    type: String,
    required: true,              // 必填
    unique: true,                // 唯一索引
    trim: true,                  // 去除首尾空格
    minlength: 3,                // 最少3个字符
    maxlength: 50               // 最多50个字符
  },
  // 邮箱 - 唯一标识，用于登录和通知
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true             // 存储为小写，查询时不区分大小写
  },
  // 密码 - 加密存储
  password: {
    type: String,
    required: true,
    minlength: 6                // 最少6位
  },
  // API访问令牌 - 用于开放API认证
  apiToken: {
    type: String,
    unique: true,
    sparse: true                 // 允许null，但不创建唯一索引
  },
  // API Token过期时间
  apiTokenExpires: {
    type: Date
  },
  // 存储配额（字节）- 默认1GB
  storageQuota: {
    type: Number,
    default: 1024 * 1024 * 1024
  },
  // 已使用存储空间（字节）
  storageUsed: {
    type: Number,
    default: 0
  },
  // 账号状态
  isActive: {
    type: Boolean,
    default: true
  },
  // 最后登录时间
  lastLogin: {
    type: Date
  }
}, {
  timestamps: true              // 自动管理createdAt和updatedAt
});

/**
 * 保存前钩子 - 自动加密密码
 * 确保密码在保存到数据库前被哈希加密
 */
userSchema.pre('save', async function(next) {
  // 只有密码被修改时才重新加密
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

/**
 * 密码验证方法
 * @param {string} candidatePassword - 待验证的密码
 * @returns {Promise<boolean>} - 密码是否匹配
 */
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * 生成API Token
 * @returns {string} - 32字节的十六进制随机字符串
 *
 * Token有效期：1年
 * Token格式：64位十六进制随机字符串
 */
userSchema.methods.generateApiToken = function() {
  const token = crypto.randomBytes(32).toString('hex');
  this.apiToken = token;
  this.apiTokenExpires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  return token;
};

// 创建并导出用户模型
module.exports = mongoose.model('User', userSchema);