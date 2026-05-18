/**
 * 上传中间件 (Upload Middleware)
 *
 * 提供 Multer 和 Formidable 两种上传处理方式
 * 注意：实际使用中，fileController 直接使用 Formidable 以支持中文文件名
 */

const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;
const uploadConfig = require('../config/upload');
const fileFilter = require('./fileFilter');

/**
 * 确保目录存在
 */
const ensureDir = async (dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
};

/**
 * Multer 磁盘存储配置
 */
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const userId = req.userId || req.session?.userId;
    if (!userId) {
      return cb(new Error('未认证用户'), null);
    }

    const userDir = path.join(uploadConfig.uploadDir, userId.toString());

    if (req.body.folder) {
      const folderDir = path.join(userDir, req.body.folder);
      await ensureDir(folderDir);
      cb(null, folderDir);
    } else {
      await ensureDir(userDir);
      cb(null, userDir);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = crypto.randomBytes(8).toString('hex');
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

/**
 * Multer 上传中间件
 */
const upload = multer({
  storage,
  fileFilter: fileFilter.filter,
  limits: {
    fileSize: uploadConfig.maxFileSize,
    files: uploadConfig.maxFilesPerRequest
  }
});

/**
 * Formidable 上传处理中间件（保留中文文件名）
 * 注意：此中间件未被使用，实际在 fileController 中直接调用 Formidable
 */
const uploadWithEncoding = (req, res, next) => {
  const formidable = require('formidable');
  const form = formidable({
    uploadDir: uploadConfig.uploadDir,
    keepExtensions: true,
    maxFileSize: uploadConfig.maxFileSize,
    maxFiles: uploadConfig.maxFilesPerRequest,
    filter: ({ name, originalFilename, mimeType }) => {
      const result = fileFilter.checkExtension(originalFilename || '');
      return result.allowed;
    }
  });

  form.parse(req, (err, fields, files) => {
    if (err) {
      console.error('Form parse error:', err);
      return res.status(400).json({ success: false, message: '文件上传失败' });
    }

    req.body = fields;
    if (files.files) {
      const fileArray = Array.isArray(files.files) ? files.files : [files.files];
      req.files = fileArray.map(f => ({
        originalFilename: f.originalFilename || f.newFilename,
        mimetype: f.mimetype,
        size: f.size,
        filepath: f.filepath
      }));
    }
    next();
  });
};

/**
 * 分片上传存储配置
 */
const chunkStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadId = req.body.uploadId;
    const chunksDir = path.join(uploadConfig.uploadDir, 'chunks', uploadId);
    await ensureDir(chunksDir);
    cb(null, chunksDir);
  },
  filename: (req, file, cb) => {
    const chunkIndex = req.body.chunkIndex || '0';
    cb(null, `chunk_${chunkIndex}`);
  }
});

/**
 * 分片上传中间件
 */
const chunkUpload = multer({
  storage: chunkStorage,
  limits: { fileSize: uploadConfig.maxChunkSize }
}).single('chunk');

module.exports = {
  upload,
  uploadWithEncoding,
  chunkUpload,
  ensureDir,
  MAX_FILE_SIZE: uploadConfig.maxFileSize,
  MAX_CHUNK_SIZE: uploadConfig.maxChunkSize
};
