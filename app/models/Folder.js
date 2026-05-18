/**
 * 文件夹模型 (Folder Model)
 *
 * 功能说明：
 * - 支持层级目录结构（通过parent字段实现）
 * - 每个文件夹属于一个用户，确保数据隔离
 * - 支持软删除（删除文件夹时内部文件一并标记删除）
 *
 * 层级关系：
 * - parent为null表示根目录
 * - 通过path字段存储完整路径，方便快速查询
 * - depth字段记录层级深度，用于排序
 */

const mongoose = require('mongoose');

const folderSchema = new mongoose.Schema({
  // 文件夹名称
  name: {
    type: String,
    required: true,
    trim: true
  },
  // 父文件夹 - null表示根目录
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder',
    default: null
  },
  // 文件夹所有者 - 必填，确保数据隔离
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // 完整路径 - 格式：/parent1/parent2/name
  path: {
    type: String,
    default: '/'
  },
  // 层级深度 - 根目录为0，子文件夹依次递增
  depth: {
    type: Number,
    default: 0
  },
  // 排序权重 - 用于自定义排序
  order: {
    type: Number,
    default: 0
  },
  // 软删除标志
  isDeleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// 复合索引 - 加速用户文件夹列表查询
folderSchema.index({ owner: 1, parent: 1 });

module.exports = mongoose.model('Folder', folderSchema);