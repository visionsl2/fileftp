/**
 * 分享模型 (Share Model)
 *
 * 功能说明：
 * - 存储文件/文件夹的分享信息
 * - 支持密码保护和过期时间
 * - 生成唯一的分享令牌
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const shareSchema = new mongoose.Schema({
  // 分享类型：file 或 folder
  type: {
    type: String,
    enum: ['file', 'folder'],
    required: true
  },

  // 分享目标ID（文件或文件夹）
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },

  // 分享时的名称（保留快照）
  targetName: {
    type: String,
    required: true
  },

  // 分享令牌（唯一）
  shareToken: {
    type: String,
    required: true,
    unique: true
  },

  // 访问密码（可选）
  password: {
    type: String,
    default: null
  },

  // 过期时间（可选，null表示永不过期）
  expiresAt: {
    type: Date,
    default: null
  },

  // 浏览次数
  viewCount: {
    type: Number,
    default: 0
  },

  // 创建者
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // 分享的文件ID列表（批量分享）
  fileIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'File'
  }]
}, {
  timestamps: true
});

// 生成唯一的分享令牌
shareSchema.statics.generateToken = function() {
  return crypto.randomBytes(16).toString('hex');
};

// 检查是否过期
shareSchema.methods.isExpired = function() {
  if (!this.expiresAt) return false;
  return new Date() > this.expiresAt;
};

// 检查是否有效
shareSchema.methods.isValid = function() {
  return !this.isExpired();
};

module.exports = mongoose.model('Share', shareSchema);