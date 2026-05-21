/**
 * 上传配置
 *
 * 配置说明：
 * - UPLOAD_DIR: 文件存储根目录，支持任意磁盘路径
 *   Windows示例: D:/uploads 或 E:\\FileFTP\\uploads
 *   Linux示例: /home/user/uploads 或 ./uploads
 */

const path = require('path');
const fs = require('fs');

// 获取上传目录配置
function getUploadDir() {
  const uploadDir = process.env.UPLOAD_DIR || './uploads';

  // 转换为绝对路径
  let absolutePath;
  if (path.isAbsolute(uploadDir)) {
    absolutePath = uploadDir;
  } else {
    absolutePath = path.resolve(uploadDir);
  }

  // 统一路径分隔符（用于显示和存储）
  return absolutePath.replace(/\\/g, '/');
}

// 确保上传目录存在
function ensureUploadDir() {
  const uploadDir = getUploadDir();
  if (!fs.existsSync(uploadDir)) {
    try {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log(`Upload directory created: ${uploadDir}`);
    } catch (error) {
      console.error(`Failed to create upload directory: ${uploadDir}`, error.message);
      throw error;
    }
  }
}

// 启动时验证
try {
  ensureUploadDir();
} catch (error) {
  console.warn('Warning: Upload directory not available. Will be created on first upload.');
}

module.exports = {
  uploadDir: getUploadDir(),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 1024 * 1024 * 1024,
  maxChunkSize: parseInt(process.env.MAX_CHUNK_SIZE) || 5 * 1024 * 1024,
  maxFilesPerRequest: parseInt(process.env.MAX_FILES_PER_REQUEST) || 10
};