/**
 * 文件模型 (File Model)
 *
 * 功能说明：
 * - 存储文件元数据（名称、大小、类型等）
 * - 关联文件所有者（用户）和所属文件夹
 * - 支持软删除（isDeleted标志）
 * - 记录下载统计信息
 *
 * 存储策略：
 * - 物理文件存储在uploads目录下
 * - 数据库只存储文件路径和元数据
 * - 文件名使用UUID生成，保证唯一性
 */

const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  // 存储文件名 - 服务器端生成的文件名（唯一）
  filename: {
    type: String,
    required: true
  },
  // 原始文件名 - 用户上传时的文件名
  originalName: {
    type: String,
    required: true
  },
  // MIME类型 - 用于设置Content-Type响应头
  mimeType: {
    type: String,
    required: true
  },
  // 文件扩展名 - 用于图标显示和文件类型判断
  extension: {
    type: String,
    required: true
  },
  // 文件大小（字节）
  size: {
    type: Number,
    required: true
  },
  // 存储信息
  storage: {
    path: String           // 物理文件路径（相对路径）
  },
  // 所属文件夹 - null表示根目录
  folder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder',
    default: null
  },
  // 文件所有者 - 必填，确保数据隔离
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // 分片上传信息
  upload: {
    complete: {
      type: Boolean,
      default: true      // 默认已完成（普通上传）
    },
    chunksTotal: {
      type: Number,
      default: 0          // 总分片数
    },
    chunksUploaded: {
      type: Number,
      default: 0          // 已上传分片数
    }
  },
  // 统计信息
  stats: {
    downloads: {
      type: Number,
      default: 0          // 下载次数
    },
    lastDownload: Date    // 最后下载时间
  },
  // 缩略图信息（仅图片文件）
  thumb: {
    path: String,         // 缩略图路径
    width: Number,        // 缩略图宽度
    height: Number       // 缩略图高度
  },
  // 软删除标志 - true表示已删除
  isDeleted: {
    type: Boolean,
    default: false
  },
  // 删除时间
  deletedAt: Date
}, {
  timestamps: true        // 自动管理createdAt和updatedAt
});

// 复合索引 - 加速用户文件列表查询
fileSchema.index({ owner: 1, folder: 1 });

// 全文索引 - 支持文件名搜索
fileSchema.index({ originalName: 'text' });

module.exports = mongoose.model('File', fileSchema);