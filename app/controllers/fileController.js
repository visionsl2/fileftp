/**
 * 文件控制器 (File Controller)
 *
 * 功能说明：
 * - 文件列表浏览
 * - 文件上传（使用formidable处理，支持中文文件名）
 * - 文件下载（支持中文文件名）
 * - 文件删除（软删除）
 * - 文件信息查询
 */

const File = require('../models/File');
const User = require('../models/User');
const Folder = require('../models/Folder');
const storageService = require('../services/storageService');
const uploadConfig = require('../config/upload');
const helpers = require('../utils/helpers');
const path = require('path');
const formidable = require('formidable').formidable;

const fileController = {
  /**
   * 获取文件列表
   *
   * @param {Object} req.query.folder - 文件夹ID，null表示根目录
   *
   * 返回数据：
   * - files: 文件列表
   * - folders: 文件夹列表
   * - breadcrumb: 面包屑导航路径
   * - user: 当前用户信息（含存储配额）
   */
  listFiles: async (req, res) => {
    try {
      const { folder } = req.query;
      const userId = req.userId || req.session?.userId;

      // 未登录则跳转登录页
      if (!userId) {
        return res.redirect('/auth/login');
      }

      // 获取用户信息（用于显示存储配额）
      const user = await User.findById(userId);

      // 查询文件和文件夹（按更新时间倒序）
      const [files, folders] = await Promise.all([
        File.find({
          owner: userId,
          folder: folder || null,
          isDeleted: false
        }).sort({ updatedAt: -1 }),
        Folder.find({
          owner: userId,
          parent: folder || null,
          isDeleted: false
        }).sort({ order: 1, name: 1 })
      ]);

      // 构建面包屑导航
      let breadcrumb = [];
      if (folder) {
        breadcrumb = await buildBreadcrumb(folder, userId);
      }

      // 渲染文件浏览器页面
      res.render('files/browser', {
        files,
        folders,
        currentFolder: folder || null,
        breadcrumb,
        user,
        title: '我的文件',
        formatFileSize: helpers.formatFileSize,
        formatDate: helpers.formatDate,
        getFileIcon: helpers.getFileIcon,
        getFileIconClass: helpers.getFileIconClass
      });
    } catch (error) {
      console.error('listFiles error:', error);
      res.status(500).json({ success: false, message: '获取文件列表失败' });
    }
  },

  /**
   * 上传文件
   *
   * 使用formidable处理multipart/form-data请求
   * 支持多文件上传和文件类型过滤
   *
   * 流程：
   * 1. 解析上传请求
   * 2. 过滤禁止的文件类型（如.js/.exe等）
   * 3. 检查存储配额
   * 4. 保存文件到目标目录
   * 5. 创建数据库记录
   * 6. 更新用户已使用存储空间
   */
  uploadFiles: async (req, res) => {
    const userId = req.userId || req.session?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

    // 解析上传请求
    const parsed = await new Promise((resolve, reject) => {
      const form = formidable({
        uploadDir: uploadConfig.uploadDir,
        keepExtensions: true,
        maxFileSize: uploadConfig.maxFileSize,
        maxFiles: uploadConfig.maxFilesPerRequest,
        maxTotalFileSize: uploadConfig.maxFileSize * uploadConfig.maxFilesPerRequest
      });

      // 文件类型过滤
      const fileFilter = require('../middlewares/fileFilter');
      form.on('file', (formName, file) => {
        const result = fileFilter.checkExtension(file.originalFilename || file.newFilename || '');
        if (!result.allowed) {
          file._blocked = true;
        }
      });

      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    // formidable v2 returns fields as plain values (not arrays), so we need to handle both cases
    const folderIdRaw = Array.isArray(parsed.fields.folder)
      ? parsed.fields.folder[0]
      : (parsed.fields.folder || '');
    const folderId = folderIdRaw && /^[a-fA-F0-9]{24}$/.test(folderIdRaw) ? folderIdRaw : null;
    const user = await User.findById(userId);

    // 处理文件列表
    let fileList = parsed.files.files;
    if (!Array.isArray(fileList)) {
      fileList = fileList ? [fileList] : [];
    }

    // 过滤被阻止的文件
    const validFiles = fileList.filter(f => !f._blocked);

    if (validFiles.length === 0) {
      return res.status(400).json({
        success: false,
        message: '禁止上传该类型的文件或没有上传文件'
      });
    }

    // 计算总大小并检查配额
    let totalSize = validFiles.reduce((sum, f) => sum + f.size, 0);

    if (user.storageUsed + totalSize > user.storageQuota) {
      // 清理已上传的临时文件
      for (const f of validFiles) {
        await storageService.deleteFile(f.filepath).catch(() => {});
      }
      return res.status(400).json({
        success: false,
        message: '存储空间不足'
      });
    }

    const uploadedFiles = [];

    // 处理每个文件
    for (const file of validFiles) {
      try {
        const ext = path.extname(file.originalFilename || file.newFilename);
        const storage = await storageService.processUploadedFile(file.filepath, userId, folderId, ext);

        const fileDoc = new File({
          filename: storage.relativePath,
          originalName: file.originalFilename || path.basename(file.newFilename, ext),
          mimeType: file.mimetype,
          extension: ext.toLowerCase(),
          size: file.size,
          storage: { path: storage.path },
          folder: folderId,
          owner: userId
        });

        await fileDoc.save();

        // 如果是图片文件，生成缩略图
        if (storageService.isImage(ext)) {
          try {
            const thumbInfo = await storageService.generateThumbnail(
              storage.path,
              fileDoc._id.toString(),
              userId
            );
            fileDoc.thumb = thumbInfo;
            await fileDoc.save();
          } catch (thumbErr) {
            console.error('Generate thumbnail error:', thumbErr);
          }
        }

        uploadedFiles.push(fileDoc);
      } catch (fileErr) {
        console.error('Save file error:', fileErr);
        await storageService.deleteFile(file.filepath).catch(() => {});
      }
    }

    // 更新用户已使用存储空间
    await User.findByIdAndUpdate(userId, {
      $inc: { storageUsed: totalSize }
    });

    res.json({
      success: true,
      files: uploadedFiles.map(f => ({
        id: f._id,
        name: f.originalName,
        size: f.size,
        type: f.mimeType
      }))
    });
  },

  /**
   * 下载文件
   *
   * 使用流式传输，避免大文件内存溢出
   * 使用RFC 5987标准编码中文文件名
   *
   * 流程：
   * 1. 查询文件记录（验证所有权）
   * 2. 设置响应头（Content-Type, Content-Disposition等）
   * 3. 使用流传输文件内容
   */
  downloadFile: async (req, res) => {
    try {
      const userId = req.userId;

      // 查询文件记录，确保属于当前用户
      const file = await File.findOne({
        _id: req.params.id,
        owner: userId,
        isDeleted: false
      });

      if (!file) {
        return res.status(404).json({ success: false, message: '文件不存在' });
      }

      // 更新下载统计
      await File.findByIdAndUpdate(file._id, {
        $inc: { 'stats.downloads': 1 },
        'stats.lastDownload': new Date()
      });

      // RFC 5987标准编码中文文件名，兼容各种浏览器
      const encodedFilename = encodeURIComponent(file.originalName);
      res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', file.size);

      // 流式传输文件
      const readStream = storageService.createReadStream(file.storage.path);
      readStream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: '下载失败' });
        }
      });
      readStream.pipe(res);
    } catch (error) {
      console.error('downloadFile error:', error);
      res.status(500).json({ success: false, message: '下载失败' });
    }
  },

  /**
   * 删除文件（软删除）
   *
   * 流程：
   * 1. 查询文件记录
   * 2. 标记为已删除（不物理删除文件记录）
   * 3. 减少用户已使用存储空间
   * 4. 删除物理文件
   */
  deleteFile: async (req, res) => {
    try {
      const file = await File.findOne({
        _id: req.params.id,
        owner: req.userId || req.session?.userId
      });

      if (!file) {
        return res.status(404).json({ success: false, message: '文件不存在' });
      }

      // 软删除
      file.isDeleted = true;
      file.deletedAt = new Date();
      await file.save();

      // 减少用户已使用存储空间
      await User.findByIdAndUpdate(req.userId || req.session?.userId, {
        $inc: { storageUsed: -file.size }
      });

      // 删除物理文件
      await storageService.deleteFile(file.storage.path);

      // 删除缩略图
      if (file.thumb && file.thumb.path) {
        await storageService.deleteThumbnail(file.thumb.path);
      }

      res.json({ success: true });
    } catch (error) {
      console.error('deleteFile error:', error);
      res.status(500).json({ success: false, message: '删除失败' });
    }
  },

  /**
   * 获取文件信息
   */
  getFileInfo: async (req, res) => {
    try {
      const file = await File.findOne({
        _id: req.params.id,
        owner: req.userId || req.session?.userId,
        isDeleted: false
      });

      if (!file) {
        return res.status(404).json({ success: false, message: '文件不存在' });
      }

      res.json({
        success: true,
        file: {
          id: file._id,
          name: file.originalName,
          size: file.size,
          type: file.mimeType,
          extension: file.extension,
          createdAt: file.createdAt,
          downloads: file.stats.downloads
        }
      });
    } catch (error) {
      console.error('getFileInfo error:', error);
      res.status(500).json({ success: false, message: '获取文件信息失败' });
    }
  },

  /**
   * 获取图片缩略图
   *
   * 返回真正的缩略图文件（如果存在），否则返回原始图片
   */
  getThumbnail: async (req, res) => {
    try {
      const userId = req.userId;

      const file = await File.findOne({
        _id: req.params.id,
        owner: userId,
        isDeleted: false
      });

      if (!file) {
        return res.status(404).json({ success: false, message: '文件不存在' });
      }

      // 检查是否为图片类型
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'];
      if (!imageExtensions.includes(file.extension.toLowerCase())) {
        return res.status(400).json({ success: false, message: '不是图片文件' });
      }

      // 设置缓存头（1小时）
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Type', 'image/jpeg');

      // 如果有缩略图，返回缩略图；否则返回原图
      let filePath = file.storage.path;
      if (file.thumb && file.thumb.path) {
        filePath = file.thumb.path;
      }

      const readStream = storageService.createReadStream(filePath);
      readStream.on('error', (err) => {
        console.error('Thumbnail stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: '缩略图加载失败' });
        }
      });
      readStream.pipe(res);
    } catch (error) {
      console.error('getThumbnail error:', error);
      res.status(500).json({ success: false, message: '缩略图加载失败' });
    }
  },

  /**
   * 获取图片预览（原图）
   *
   * 返回完整尺寸的图片用于预览模态框
   */
  getPreview: async (req, res) => {
    try {
      const userId = req.userId;

      const file = await File.findOne({
        _id: req.params.id,
        owner: userId,
        isDeleted: false
      });

      if (!file) {
        return res.status(404).json({ success: false, message: '文件不存在' });
      }

      // 检查是否为图片类型
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'];
      if (!imageExtensions.includes(file.extension.toLowerCase())) {
        return res.status(400).json({ success: false, message: '不是图片文件' });
      }

      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', file.size);

      const readStream = storageService.createReadStream(file.storage.path);
      readStream.on('error', (err) => {
        console.error('Preview stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: '预览加载失败' });
        }
      });
      readStream.pipe(res);
    } catch (error) {
      console.error('getPreview error:', error);
      res.status(500).json({ success: false, message: '预览加载失败' });
    }
  },

  /**
   * 重命名文件
   */
  renameFile: async (req, res) => {
    try {
      const userId = req.userId;
      const { name } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: '文件名不能为空' });
      }

      const file = await File.findOne({
        _id: req.params.id,
        owner: userId,
        isDeleted: false
      });

      if (!file) {
        return res.status(404).json({ success: false, message: '文件不存在' });
      }

      file.originalName = name.trim();
      await file.save();

      res.json({ success: true, name: file.originalName });
    } catch (error) {
      console.error('renameFile error:', error);
      res.status(500).json({ success: false, message: '重命名失败' });
    }
  },

  /**
   * 移动文件到指定文件夹
   */
  moveFile: async (req, res) => {
    try {
      const userId = req.userId;
      const { folder } = req.body; // 目标文件夹ID，null表示根目录

      const file = await File.findOne({
        _id: req.params.id,
        owner: userId,
        isDeleted: false
      });

      if (!file) {
        return res.status(404).json({ success: false, message: '文件不存在' });
      }

      // 如果目标文件夹存在，验证所有权
      if (folder) {
        const targetFolder = await Folder.findOne({
          _id: folder,
          owner: userId,
          isDeleted: false
        });
        if (!targetFolder) {
          return res.status(404).json({ success: false, message: '目标文件夹不存在' });
        }
      }

      file.folder = folder || null;
      await file.save();

      res.json({ success: true });
    } catch (error) {
      console.error('moveFile error:', error);
      res.status(500).json({ success: false, message: '移动失败' });
    }
  },

  /**
   * 批量移动文件
   */
  moveBatchFiles: async (req, res) => {
    try {
      const userId = req.userId;
      const { fileIds, folder } = req.body;

      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ success: false, message: '请选择要移动的文件' });
      }

      // 如果目标文件夹存在，验证所有权
      if (folder) {
        const targetFolder = await Folder.findOne({
          _id: folder,
          owner: userId,
          isDeleted: false
        });
        if (!targetFolder) {
          return res.status(404).json({ success: false, message: '目标文件夹不存在' });
        }
      }

      await File.updateMany(
        {
          _id: { $in: fileIds },
          owner: userId,
          isDeleted: false
        },
        { $set: { folder: folder || null } }
      );

      res.json({ success: true });
    } catch (error) {
      console.error('moveBatchFiles error:', error);
      res.status(500).json({ success: false, message: '批量移动失败' });
    }
  }
};

/**
 * 构建面包屑导航
 *
 * @param {string} folderId - 当前文件夹ID
 * @param {string} userId - 用户ID
 * @returns {Array} - 面包屑数组 [{id, name}, ...]
 */
async function buildBreadcrumb(folderId, userId) {
  const breadcrumb = [];
  let currentId = folderId;

  // 循环向上查找父文件夹，直到根目录
  while (currentId) {
    const folder = await Folder.findOne({ _id: currentId, owner: userId });
    if (!folder) break;

    breadcrumb.unshift({ id: folder._id, name: folder.name });
    currentId = folder.parent;
  }

  return breadcrumb;
}

module.exports = fileController;