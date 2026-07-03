/**
 * API控制器 (API Controller)
 *
 * 功能说明：
 * - 供第三方系统调用的REST API
 * - 使用API Token进行认证
 * - 支持文件上传、查询、下载、删除
 *
 * 认证方式：
 * - Header: X-API-Token: your-token
 * - 或 Header: Authorization: Bearer your-token
 * - 或 Query: ?api_token=your-token
 */

const User = require('../models/User');
const File = require('../models/File');
const Folder = require('../models/Folder');
const storageService = require('../services/storageService');
const aiQueue = require('../services/aiQueue');
const path = require('path');

const apiController = {
  /**
   * 获取API Token
   *
   * @param {string} req.body.email - 用户邮箱
   * @param {string} req.body.password - 密码
   *
   * @returns {string} apiToken - API访问令牌
   *
   * 注意：Token有效期为1年，请妥善保管
   */
  generateToken: async (req, res) => {
    try {
      const { email, password } = req.body;

      // 验证必填字段
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'MISSING_CREDENTIALS',
          message: '请提供邮箱和密码'
        });
      }

      const user = await User.findOne({ email });

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'INVALID_CREDENTIALS',
          message: '邮箱或密码错误'
        });
      }

      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          error: 'ACCOUNT_DISABLED',
          message: '账号已被禁用'
        });
      }

      // 验证密码
      const isMatch = await user.comparePassword(password);

      if (!isMatch) {
        return res.status(401).json({
          success: false,
          error: 'INVALID_CREDENTIALS',
          message: '邮箱或密码错误'
        });
      }

      // 生成或更新API Token
      let apiToken = user.apiToken;

      if (!apiToken || (user.apiTokenExpires && user.apiTokenExpires < new Date())) {
        apiToken = user.generateApiToken();
        await user.save();
      }

      res.json({
        success: true,
        token: apiToken,
        expiresAt: user.apiTokenExpires,
        message: 'API Token获取成功，请妥善保存'
      });
    } catch (error) {
      console.error('Generate API token error:', error);
      res.status(500).json({
        success: false,
        error: 'SERVER_ERROR',
        message: '服务器错误'
      });
    }
  },

  /**
   * API上传文件
   *
   * @param {File} req.file - 上传的文件
   * @param {string} req.body.folder - 目标文件夹ID（可选）
   *
   * 返回文件信息：id, name, size, type, extension, createdAt
   */
  uploadFile: async (req, res) => {
    try {
      const user = req.apiUser;
      const file = req.file;
      const { folder } = req.body;

      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'NO_FILE',
          message: '没有上传文件'
        });
      }

      const userDoc = await User.findById(user._id);

      // 检查存储配额
      if (userDoc.storageUsed + file.size > userDoc.storageQuota) {
        await storageService.deleteFile(file.path);
        return res.status(400).json({
          success: false,
          error: 'STORAGE_EXCEEDED',
          message: '存储空间不足'
        });
      }

      const storage = await storageService.saveFile(file.path, user._id, folder || null);

      // 计算 SHA-256（流式，大文件不卡）
      let sha256 = null;
      try {
        sha256 = await storageService.getFileHash(storage.path);
      } catch (hashErr) {
        console.warn('[API Upload] SHA-256 compute failed:', hashErr.message);
      }

      const fileDoc = new File({
        filename: storage.relativePath,
        originalName: file.originalname,
        mimeType: file.mimetype,
        extension: path.extname(file.originalname).toLowerCase(),
        size: file.size,
        sha256,
        storage: { path: storage.relativePath },
        folder: folder || null,
        owner: user._id
      });

      await fileDoc.save();

      // AI 自动分析（与主系统一致：标记 + 后台异步）
      const _pendingAi = [];
      const aiAutoClassify = process.env.AI_AUTO_CLASSIFY === 'true';
      const ext = path.extname(file.originalname).toLowerCase();
      const isMedia = storageService.isImage(ext) || storageService.isVideo(ext);
      if (aiAutoClassify && isMedia) {
        const quotaOk = await aiQueue.checkAiQuota(user);
        if (quotaOk) {
          _pendingAi.push({
            fileId: fileDoc._id.toString(),
            storagePath: storage.path,
            isVideo: storageService.isVideo(ext),
            userId: user._id
          });
        }
      }

      // 更新用户存储使用量
      await User.findByIdAndUpdate(user._id, {
        $inc: { storageUsed: file.size }
      });

      // 调度后台 AI 分析
      if (_pendingAi.length > 0) {
        aiQueue.scheduleAiAnalysis(_pendingAi);
      }

      res.json({
        success: true,
        file: {
          id: fileDoc._id,
          name: fileDoc.originalName,
          size: fileDoc.size,
          type: fileDoc.mimeType,
          extension: fileDoc.extension,
          sha256: fileDoc.sha256,
          createdAt: fileDoc.createdAt
        }
      });
    } catch (error) {
      console.error('API upload error:', error);
      res.status(500).json({
        success: false,
        error: 'UPLOAD_ERROR',
        message: '上传失败'
      });
    }
  },

  /**
   * API获取文件列表
   *
   * @param {string} req.query.folder - 文件夹ID（可选）
   * @param {number} req.query.page - 页码（默认1）
   * @param {number} req.query.limit - 每页数量（默认20）
   */
  listFiles: async (req, res) => {
    try {
      const user = req.apiUser;
      const { folder, page = 1, limit = 20 } = req.query;

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [files, total] = await Promise.all([
        File.find({
          owner: user._id,
          folder: folder || null,
          isDeleted: false
        })
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        File.countDocuments({
          owner: user._id,
          folder: folder || null,
          isDeleted: false
        })
      ]);

      res.json({
        success: true,
        files: files.map(f => ({
          id: f._id,
          name: f.originalName,
          size: f.size,
          type: f.mimeType,
          extension: f.extension,
          sha256: f.sha256,
          folder: f.folder,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('API list files error:', error);
      res.status(500).json({
        success: false,
        error: 'SERVER_ERROR',
        message: '获取文件列表失败'
      });
    }
  },

  /**
   * API获取文件信息
   *
   * @param {string} req.params.id - 文件ID
   */
  getFileInfo: async (req, res) => {
    try {
      const user = req.apiUser;

      const file = await File.findOne({
        _id: req.params.id,
        owner: user._id,
        isDeleted: false
      });

      if (!file) {
        return res.status(404).json({
          success: false,
          error: 'FILE_NOT_FOUND',
          message: '文件不存在'
        });
      }

      res.json({
        success: true,
        file: {
          id: file._id,
          name: file.originalName,
          size: file.size,
          type: file.mimeType,
          extension: file.extension,
          folder: file.folder,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
          downloads: file.stats.downloads
        }
      });
    } catch (error) {
      console.error('API get file info error:', error);
      res.status(500).json({
        success: false,
        error: 'SERVER_ERROR',
        message: '获取文件信息失败'
      });
    }
  },

  /**
   * 批量查重接口 — 给客户端检测哪些 SHA-256 已存在
   * POST /api/v1/files/check-duplicates
   * Body: { hashes: ["sha1", "sha2", ...] }
   * Response: { duplicates: {hash: {id, name}}, new: ["hash2"] }
   */
  checkDuplicates: async (req, res) => {
    try {
      const user = req.apiUser;
      const { hashes } = req.body || {};

      if (!Array.isArray(hashes) || hashes.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_HASHES',
          message: '请提供 hashes 数组'
        });
      }

      // 单次最多 500 个，超出分批由客户端处理
      const MAX_BATCH = 500;
      const inputHashes = hashes.slice(0, MAX_BATCH);

      // 简单格式校验：SHA-256 是 64 位十六进制
      const validHashes = inputHashes.filter(h =>
        typeof h === 'string' && /^[a-fA-F0-9]{64}$/.test(h)
      );

      if (validHashes.length === 0) {
        return res.json({ success: true, duplicates: {}, new: inputHashes });
      }

      // 一次查询：按 owner + sha256 命中
      const existing = await File.find({
        owner: user._id,
        sha256: { $in: validHashes },
        isDeleted: false
      }, 'sha256 originalName').lean();

      const duplicates = {};
      const foundHashes = new Set();
      existing.forEach(f => {
        if (f.sha256) {
          duplicates[f.sha256] = { id: f._id, name: f.originalName };
          foundHashes.add(f.sha256);
        }
      });

      // new: 输入中未命中的（含格式不合法）
      const newHashes = inputHashes.filter(h => !foundHashes.has(h));

      res.json({
        success: true,
        duplicates,
        new: newHashes,
        stats: {
          input: inputHashes.length,
          duplicates: Object.keys(duplicates).length,
          new: newHashes.length
        }
      });
    } catch (error) {
      console.error('API check duplicates error:', error);
      res.status(500).json({
        success: false,
        error: 'SERVER_ERROR',
        message: '查重失败'
      });
    }
  },

  /**
   * API下载文件
   *
   * @param {string} req.params.id - 文件ID
   */
  downloadFile: async (req, res) => {
    try {
      const user = req.apiUser;

      const file = await File.findOne({
        _id: req.params.id,
        owner: user._id,
        isDeleted: false
      });

      if (!file) {
        return res.status(404).json({
          success: false,
          error: 'FILE_NOT_FOUND',
          message: '文件不存在'
        });
      }

      // 更新下载统计
      await File.findByIdAndUpdate(file._id, {
        $inc: { 'stats.downloads': 1 },
        'stats.lastDownload': new Date()
      });

      // 设置响应头
      const encodedFilename = encodeURIComponent(file.originalName);
      res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', file.size);

      // 流式传输
      const readStream = storageService.createReadStream(storageService.resolvePath(file.storage.path));
      readStream.pipe(res);
    } catch (error) {
      console.error('API download error:', error);
      res.status(500).json({
        success: false,
        error: 'SERVER_ERROR',
        message: '下载失败'
      });
    }
  },

  /**
   * API删除文件
   *
   * @param {string} req.params.id - 文件ID
   */
  deleteFile: async (req, res) => {
    try {
      const user = req.apiUser;

      const file = await File.findOne({
        _id: req.params.id,
        owner: user._id
      });

      if (!file) {
        return res.status(404).json({
          success: false,
          error: 'FILE_NOT_FOUND',
          message: '文件不存在'
        });
      }

      // 软删除
      file.isDeleted = true;
      file.deletedAt = new Date();
      await file.save();

      // 减少存储使用量
      await User.findByIdAndUpdate(user._id, {
        $inc: { storageUsed: -file.size }
      });

      // 删除物理文件
      await storageService.deleteFile(storageService.resolvePath(file.storage.path));

      res.json({ success: true });
    } catch (error) {
      console.error('API delete error:', error);
      res.status(500).json({
        success: false,
        error: 'SERVER_ERROR',
        message: '删除失败'
      });
    }
  }
};

module.exports = apiController;