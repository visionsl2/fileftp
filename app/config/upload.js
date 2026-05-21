/**
 * 上传配置
 * 
 * UPLOAD_DIR: 文件存储根目录，支持任意磁盘路径
 */

const path = require('path');
const fs = require('fs');

console.log('[upload.js] 开始加载, process.env.UPLOAD_DIR =', process.env.UPLOAD_DIR);

function getUploadDir() {
  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  let result;
  if (path.isAbsolute(uploadDir)) {
    result = uploadDir;
  } else {
    result = path.resolve(uploadDir);
  }
  // 统一路径分隔符
  result = result.replace(/\\/g, '/');
  console.log('[upload.js] getUploadDir() 返回 =', result);
  return result;
}

function ensureUploadDir() {
  const dir = getUploadDir();
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      console.log('[upload.js] 目录已创建:', dir);
    } catch (e) {
      console.error('[upload.js] 创建目录失败:', e.message);
    }
  }
}

ensureUploadDir();

const config = {
  uploadDir: getUploadDir(),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 1024 * 1024 * 1024,
  maxChunkSize: parseInt(process.env.MAX_CHUNK_SIZE) || 5 * 1024 * 1024,
  maxFilesPerRequest: parseInt(process.env.MAX_FILES_PER_REQUEST) || 10
};

console.log('[upload.js] 最终 uploadDir =', config.uploadDir);

module.exports = config;
