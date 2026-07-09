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
const aiQueue = require('../services/aiQueue');

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
      const { folder, page = 1, limit = 50 } = req.query;
      const userId = req.userId || req.session?.userId;
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
      const skip = (pageNum - 1) * limitNum;

      // 未登录则跳转登录页
      if (!userId) {
        return res.redirect('/auth/login');
      }

      // 获取用户信息（用于显示存储配额）
      const user = await User.findById(userId);

      // 查询文件和文件夹（按更新时间倒序，分页）
      // 只 select 需要的字段，减少响应体积
      const fileFields = 'originalName extension mimeType size sha256 folder updatedAt thumb aiAnalysis';
      const [files, folders, recentFiles, totalFiles] = await Promise.all([
        File.find({
          owner: userId,
          folder: folder || null,
          isDeleted: false
        }).select(fileFields).sort({ updatedAt: -1 }).skip(skip).limit(limitNum).lean(),
        Folder.find({
          owner: userId,
          parent: folder || null,
          isDeleted: false
        }).sort({ order: 1, name: 1 }),
        File.find({
          owner: userId,
          isDeleted: false
        }).select(fileFields).sort({ createdAt: -1 }).limit(10).lean(),
        File.countDocuments({
          owner: userId,
          folder: folder || null,
          isDeleted: false
        })
      ]);

      // 构建面包屑导航
      let breadcrumb = [];
      if (folder) {
        breadcrumb = await buildBreadcrumb(folder, userId);
      }

      // 渲染文件浏览器页面
      // AI 配额信息
      const aiQuota = await getAiQuota(user);

      res.render('files/browser', {
        files,
        folders,
        recentFiles,
        currentFolder: folder || null,
        breadcrumb,
        user,
        aiQuota,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalFiles,
          totalPages: Math.ceil(totalFiles / limitNum)
        },
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
   * 滚动加载更多文件（分页）
   * GET /files/more?folder=xxx&page=2
   */
  loadMoreFiles: async (req, res) => {
    try {
      const { folder, page = 2, limit = 50 } = req.query;
      const userId = req.userId || req.session?.userId;
      if (!userId) {
        return res.status(401).json({ success: false, message: '未认证' });
      }
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
      const skip = (pageNum - 1) * limitNum;

      const fileFields = 'originalName extension mimeType size sha256 folder updatedAt thumb aiAnalysis';
      const [files, totalFiles] = await Promise.all([
        File.find({
          owner: userId,
          folder: folder || null,
          isDeleted: false
        }).select(fileFields).sort({ updatedAt: -1 }).skip(skip).limit(limitNum).lean(),
        File.countDocuments({
          owner: userId,
          folder: folder || null,
          isDeleted: false
        })
      ]);

      // 渲染为 HTML 片段（前端直接 innerHTML 插入）
      res.render('files/_file_item_partial', {
        files,
        formatFileSize: helpers.formatFileSize,
        formatDate: helpers.formatDate,
        getFileIcon: helpers.getFileIcon,
        getFileIconClass: helpers.getFileIconClass
      }, (err, html) => {
        if (err) return res.status(500).json({ success: false, message: '渲染失败' });
        res.json({
          success: true,
          html,
          hasMore: skip + files.length < totalFiles,
          nextPage: pageNum + 1,
          total: totalFiles
        });
      });
    } catch (error) {
      console.error('loadMoreFiles error:', error);
      res.status(500).json({ success: false, message: '加载更多失败' });
    }
  },

  /**
   * 总览页：按上传时间倒序展示所有文件（传统翻页 + 文件类型筛选）
   * GET /files/gallery?page=N&type=image|video|other
   * 仅当前用户，不可跨用户访问
   */
  showGallery: async (req, res) => {
    try {
      const userId = req.userId || req.session?.userId;
      if (!userId) return res.redirect('/auth/login');

      const limitNum = 50;
      const type = ['image', 'video', 'other'].includes(req.query.type) ? req.query.type : '';

      // 复用 storageService 扩展名定义，避免重复维护
      const imageExts = storageService.IMAGE_EXTENSIONS;
      const videoExts = storageService.VIDEO_EXTENSIONS;
      const mediaExts = [...imageExts, ...videoExts];
      // 预计算大小写不敏感的正则数组（只生成一次）
      const toRegex = (ext) => new RegExp('^' + ext.replace('.', '\\.') + '$', 'i');
      const imgRegexIn = imageExts.map(toRegex);
      const videoRegexIn = videoExts.map(toRegex);
      const mediaRegexIn = mediaExts.map(toRegex);

      // 基础查询条件
      const baseQuery = { owner: userId, isDeleted: false };
      let query = baseQuery;
      if (type === 'image') query = { ...baseQuery, extension: { $in: imgRegexIn } };
      else if (type === 'video') query = { ...baseQuery, extension: { $in: videoRegexIn } };
      else if (type === 'other') query = { ...baseQuery, extension: { $nin: mediaRegexIn } };

      // 先算总数用于边界钳制
      const totalFiles = await File.countDocuments(query);
      const totalPages = Math.max(1, Math.ceil(totalFiles / limitNum));
      let pageNum = Math.max(1, parseInt(req.query.page) || 1);
      if (pageNum > totalPages) pageNum = totalPages;
      const skip = (pageNum - 1) * limitNum;

      const fileFields = 'originalName extension mimeType size folder updatedAt thumb aiAnalysis';

      // 各类型数量（用于筛选标签角标）
      const [user, files, countAll, countImage, countVideo] = await Promise.all([
        User.findById(userId),
        File.find(query)
          .select(fileFields)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        File.countDocuments(baseQuery),
        File.countDocuments({ ...baseQuery, extension: { $in: imgRegexIn } }),
        File.countDocuments({ ...baseQuery, extension: { $in: videoRegexIn } })
      ]);
      const countOther = countAll - countImage - countVideo;

      const aiQuota = await getAiQuota(user);

      res.render('files/gallery', {
        files,
        user,
        aiQuota,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalFiles,
          totalPages,
          type
        },
        typeCounts: { all: countAll, image: countImage, video: countVideo, other: countOther },
        title: '总览',
        formatFileSize: helpers.formatFileSize,
        formatDate: helpers.formatDate
      });
    } catch (error) {
      console.error('showGallery error:', error);
      res.status(500).json({ success: false, message: '加载总览失败' });
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
    try {
    const userId = req.userId || req.session?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

    // 解析上传请求
    let collectedFiles = [];
    let parsed;
    const uploadStart = Date.now();
    let totalBytesReceived = 0;
    const inProgressPaths = new Set(); // 正在写入的文件路径，失败时清理

    try {
      // 手动收集文件（formidable v2 多文件有 bug，用事件收集）
      const fileFilter = require('../middlewares/fileFilter');

      parsed = await new Promise((resolve, reject) => {
        const form = formidable({
          uploadDir: uploadConfig.uploadDir,
          keepExtensions: true,
          maxFileSize: uploadConfig.maxFileSize,
          maxFiles: uploadConfig.maxFilesPerRequest,
          maxTotalFileSize: uploadConfig.maxFileSize * uploadConfig.maxFilesPerRequest
        });

        // 跟踪上传进度
        req.on('data', (chunk) => {
          totalBytesReceived += chunk.length;
        });

        // 诊断：记录连接断开原因
        req.on('close', () => {
          if (!collectedFiles.length) {
            console.warn('[Upload] Connection closed before any file received, bytes:', totalBytesReceived);
          }
        });
        req.on('aborted', () => {
          console.warn('[Upload] Request aborted by client at', ((Date.now() - uploadStart) / 1000).toFixed(0) + 's,',
            'bytes:', totalBytesReceived, 'files received:', collectedFiles.length);
        });

        // 文件开始写入时记录路径（用于失败清理）
        form.on('fileBegin', (formName, file) => {
          inProgressPaths.add(file.filepath);
        });

        form.on('file', (formName, file) => {
          inProgressPaths.delete(file.filepath); // 文件接收完毕，从清理列表移除
          const result = fileFilter.checkExtension(file.originalFilename || file.newFilename || '');
          if (!result.allowed) {
            file._blocked = true;
          }
          collectedFiles.push(file);
          console.log('[Upload] File received:', file.originalFilename || file.newFilename,
            'size:', (file.size / 1024 / 1024).toFixed(1) + 'MB');
        });

        form.on('field', (name, value) => {
          if (name === 'folder') console.log('[Upload] Target folder:', value || 'root');
        });

        // 进度日志（每 30 秒）
        const progressTimer = setInterval(() => {
          const elapsed = ((Date.now() - uploadStart) / 1000).toFixed(0);
          console.log('[Upload] Progress:', elapsed + 's,', (totalBytesReceived / 1024 / 1024).toFixed(1) + 'MB received,',
            collectedFiles.length, 'files parsed');
        }, 30000);

        form.on('error', (err) => {
          clearInterval(progressTimer);
          reject(err);
        });

        form.parse(req, (err, fields, files) => {
          clearInterval(progressTimer);
          if (err) {
            reject(err);
          } else {
            const elapsed = ((Date.now() - uploadStart) / 1000).toFixed(1);
            console.log('[Upload] Parsed successfully in', elapsed + 's,',
              collectedFiles.length, 'files,', (totalBytesReceived / 1024 / 1024).toFixed(1) + 'MB');
            resolve({ fields, files });
          }
        });
      });
    } catch (parseErr) {
      const elapsed = ((Date.now() - uploadStart) / 1000).toFixed(1);
      // ---- 详细诊断日志 ----
      console.error('[Upload] Parse error after', elapsed + 's,',
        (totalBytesReceived / 1024 / 1024).toFixed(1) + 'MB');
      console.error('[Upload] Error name:', parseErr.name, 'code:', parseErr.code);
      console.error('[Upload] Error httpCode:', parseErr.httpCode);
      console.error('[Upload] Error message:', parseErr.message);
      if (parseErr.stack) {
        console.error('[Upload] Stack (first 3):', parseErr.stack.split(String.fromCharCode(10)).slice(0, 3).join(" | "));
      }
      try {
        const fst = require('fs');
        fst.accessSync(uploadConfig.uploadDir, fst.constants.W_OK);
        console.error('[Upload] uploadDir OK, writable:', uploadConfig.uploadDir);
      } catch (dirErr) {
        console.error('[Upload] uploadDir NOT writable:', uploadConfig.uploadDir, '-', dirErr.message);
      }

      // 清理已上传的文件 + 正在写入的残留文件
      const cleanupPaths = [
        ...collectedFiles.map(f => f.filepath),
        ...inProgressPaths
      ];
      for (const fp of cleanupPaths) {
        try { await storageService.deleteFile(fp); } catch {}
      }
      if (cleanupPaths.length > 0) {
        console.log('[Upload] Cleaned up', cleanupPaths.length, 'file(s) after failure');
      }

      // 客户端取消请求时不返回错误（连接已断开）
      if (parseErr.code === 1002) {
        return; // Request aborted, no response needed
      }

      const errMsg = parseErr.code
        ? ('上传失败 [' + parseErr.code + ']: ' + (parseErr.message || ''))
        : ('上传失败: ' + (parseErr.message || '未知错误'));
      return res.status(500).json({
        success: false,
        message: errMsg.slice(0, 200)
      });
    }

    // formidable v2 returns fields as plain values (not arrays)
    const folderIdRaw = Array.isArray(parsed.fields.folder)
      ? parsed.fields.folder[0]
      : (parsed.fields.folder || '');
    const folderId = folderIdRaw && /^[a-fA-F0-9]{24}$/.test(folderIdRaw) ? folderIdRaw : null;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    if (collectedFiles.length === 0) {
      return res.status(400).json({ success: false, message: '没有上传文件' });
    }

    // 过滤被阻止的文件
    const validFiles = collectedFiles.filter(f => !f._blocked);
    if (validFiles.length === 0) {
      // 清理临时文件
      for (const f of collectedFiles) {
        try { await storageService.deleteFile(f.filepath); } catch {}
      }
      return res.status(400).json({
        success: false,
        message: '禁止上传该类型的文件'
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
    const _pendingAiFiles = []; // 待后台 AI 分析的文件

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
          storage: { path: storage.relativePath },
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
            if (thumbInfo) {
              fileDoc.thumb = thumbInfo;
              await fileDoc.save();
            }
          } catch (thumbErr) {
            console.error('Generate thumbnail error:', thumbErr);
          }
        }

        // 如果是视频文件，生成视频缩略图
        if (storageService.isVideo(ext)) {
          try {
            const thumbInfo = await storageService.generateVideoThumbnail(
              storage.path,
              fileDoc._id.toString(),
              userId
            );
            if (thumbInfo) {
              fileDoc.thumb = thumbInfo;
              await fileDoc.save();
            }
          } catch (thumbErr) {
            console.error('Generate video thumbnail error:', thumbErr);
          }
        }

        // AI 自动分类 → 标记为待分析，后台异步处理
        const aiAutoClassify = process.env.AI_AUTO_CLASSIFY === 'true';
        const aiMode = process.env.AI_CLASSIFY_MODE || 'auto';
        const isMedia = storageService.isImage(ext) || storageService.isVideo(ext);
        const shouldAnalyze = aiAutoClassify && aiMode === 'auto' && isMedia;
        const aiQuotaOk = shouldAnalyze ? await aiQueue.checkAiQuota(user) : false;
        if (shouldAnalyze && aiQuotaOk) {
          fileDoc.aiAnalysis = { analyzed: false };
          await fileDoc.save();
          _pendingAiFiles.push({
            fileId: fileDoc._id.toString(),
            storagePath: storage.path,
            isVideo: storageService.isVideo(ext),
            userId: userId
          });
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

    // 填充文件夹路径信息
    const resultFiles = [];
    for (const f of uploadedFiles) {
      let folderPath = '';
      if (f.folder) {
        const folder = await Folder.findById(f.folder).lean();
        if (folder) folderPath = folder.path || '/' + folder.name;
      }
      resultFiles.push({
        id: f._id,
        name: f.originalName,
        size: f.size,
        type: f.mimeType,
        category: f.aiAnalysis?.category || '',
        summary: f.aiAnalysis?.summary || '',
        folderId: f.folder || null,
        folderPath: folderPath
      });
    }

    res.json({
      success: true,
      files: resultFiles,
      aiPending: _pendingAiFiles.length > 0 ? _pendingAiFiles.map(f => f.fileId) : undefined
    });

    // 后台异步 AI 分析（不阻塞上传响应）
    if (_pendingAiFiles.length > 0) {
      aiQueue.scheduleAiAnalysis([..._pendingAiFiles]);
    }
  } catch (outerErr) {
      console.error("[Upload] Unhandled error:", outerErr);
      if (!res.headersSent) {
        return res.status(500).json({ success: false, message: "服务器错误，请重试" });
      }
    }
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
      const readStream = storageService.createReadStream(storageService.resolvePath(file.storage.path));
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
      await storageService.deleteFile(storageService.resolvePath(file.storage.path));

      // 删除缩略图（deleteThumbnail 内部已调用 resolvePath）
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

      // 解析文件夹路径（如 "风景/黄昏"）
      let folderPath = '';
      if (file.folder) {
        const segments = [];
        let currentId = file.folder;
        // 最多向上找 10 层防死循环
        for (let i = 0; i < 10 && currentId; i++) {
          const f = await Folder.findById(currentId).select('name parent').lean();
          if (!f) break;
          segments.unshift(f.name);
          currentId = f.parent;
        }
        folderPath = segments.join('/');
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
          updatedAt: file.updatedAt,
          downloads: file.stats.downloads,
          folderId: file.folder ? file.folder.toString() : null,
          folderPath,
          thumb: file.thumb ? { path: file.thumb.path, width: file.thumb.width, height: file.thumb.height } : null,
          aiAnalysis: file.aiAnalysis || null
        }
      });
    } catch (error) {
      console.error('getFileInfo error:', error);
      res.status(500).json({ success: false, message: '获取文件信息失败' });
    }
  },

  /**
   * 更新文件 AI 分析结果（分类 / 描述 / 标签）
   * PATCH /files/:id/ai-analysis
   * Body: { category?, summary?, labels? }
   */
  updateAiAnalysis: async (req, res) => {
    try {
      const userId = req.userId || req.session?.userId;
      const { category, summary, labels } = req.body || {};

      const file = await File.findOne({
        _id: req.params.id,
        owner: userId,
        isDeleted: false
      });
      if (!file) {
        return res.status(404).json({ success: false, message: '文件不存在' });
      }

      // 初始化 aiAnalysis（若不存在）
      if (!file.aiAnalysis) file.aiAnalysis = {};

      if (typeof category === 'string') {
        file.aiAnalysis.category = category.trim();
      }
      if (typeof summary === 'string') {
        file.aiAnalysis.summary = summary.trim();
      }
      if (Array.isArray(labels)) {
        file.aiAnalysis.labels = labels
          .filter(l => typeof l === 'string' && l.trim())
          .map(l => l.trim())
          .slice(0, 20); // 最多 20 个标签
      }
      file.aiAnalysis.analyzed = true;
      file.aiAnalysis.analyzedAt = file.aiAnalysis.analyzedAt || new Date();

      await file.save();

      res.json({
        success: true,
        aiAnalysis: file.aiAnalysis
      });
    } catch (error) {
      console.error('updateAiAnalysis error:', error);
      res.status(500).json({ success: false, message: '更新失败' });
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

      // 检查是否为图片或视频类型（视频也可能有缩略图）
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'];
      const videoExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm', '.m4v', '.3gp'];
      if (!imageExtensions.includes(file.extension.toLowerCase()) &&
          !videoExtensions.includes(file.extension.toLowerCase())) {
        return res.status(400).json({ success: false, message: '不支持缩略图' });
      }

      // 设置缓存头（7天 + ETag）
      // 注意：ETag 用 thumbVersion（含 thumb 生成状态），避免"生成前访问过→缓存了原图/占位"后拿不到新缩略图
      const thumbVersion = (file.thumb && file.thumb.path) ? 't1' : 't0';
      const etag = '"' + file._id.toString() + '-' + thumbVersion + '"';
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      res.setHeader('ETag', etag);
      res.setHeader('Content-Type', 'image/jpeg');

      // ETag 协商缓存：客户端 If-None-Match 匹配则返回 304（无 body）
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }

      let filePath = storageService.resolvePath(file.storage.path);

      if (file.thumb && file.thumb.path) {
        // 已有缩略图 → 直接返回
        filePath = storageService.resolvePath(file.thumb.path);
      } else {
        // 无缩略图 → 实时生成并回填（避免返回几MB原图/视频原文件）
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'];
        const videoExts = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm', '.m4v', '.3gp'];
        const ext = file.extension.toLowerCase();

        if (imageExts.includes(ext)) {
          // 图片：sharp 实时缩放
          try {
            const thumb = await storageService.generateThumbnail(
              filePath, file._id.toString(), userId
            );
            if (thumb && thumb.path) {
              file.thumb = thumb;
              await file.save();
              filePath = storageService.resolvePath(thumb.path);
              res.setHeader('ETag', '"' + file._id.toString() + '-t1"');
            }
            // thumb 为 null（sharp 不可用）时 filePath 保持原图兜底
          } catch (thumbErr) {
            console.warn('[Thumbnail] 图片实时生成失败，回退原图:', file._id.toString(), thumbErr.message);
          }
        } else if (videoExts.includes(ext)) {
          // 视频：ffmpeg 实时截帧生成缩略图
          try {
            const thumb = await storageService.generateVideoThumbnail(
              filePath, file._id.toString(), userId
            );
            if (thumb && thumb.path) {
              file.thumb = thumb;
              await file.save();
              filePath = storageService.resolvePath(thumb.path);
              res.setHeader('ETag', '"' + file._id.toString() + '-t1"');            } else {
              // ffmpeg 不可用或生成失败 → 返回 404，前端 onerror 显示占位
              return res.status(404).json({ success: false, message: '视频缩略图不可用' });
            }
          } catch (thumbErr) {
            console.warn('[Thumbnail] 视频实时生成失败:', file._id.toString(), thumbErr.message);
            return res.status(404).json({ success: false, message: '视频缩略图生成失败' });
          }
        }
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

      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      res.setHeader('ETag', '"' + file._id.toString() + '"');
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', file.size);

      // ETag 协商缓存：返回 304 跳过 body 传输
      if (req.headers['if-none-match'] === '"' + file._id.toString() + '"') {
        return res.status(304).end();
      }

      const readStream = storageService.createReadStream(storageService.resolvePath(file.storage.path));
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
   * 流媒体播放（支持 HTTP Range 请求，用于视频在线播放）
   *
   * 浏览器播放视频时会发送 Range 请求来实现进度条拖拽
   */
  streamVideo: async (req, res) => {
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

      const filePath = storageService.resolvePath(file.storage.path);
      const fs = require('fs');
      const stat = await fs.promises.stat(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        // 解析 Range 请求头 "bytes=start-end"
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': file.mimeType
        });

        const stream = fs.createReadStream(filePath, { start, end });
        stream.pipe(res);
        stream.on('error', (err) => {
          console.error('Video stream error:', err);
          if (!res.headersSent) {
            res.status(500).json({ success: false, message: '播放失败' });
          }
        });
      } else {
        // 无 Range 请求则返回完整文件
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': file.mimeType,
          'Accept-Ranges': 'bytes'
        });

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        stream.on('error', (err) => {
          console.error('Video stream error:', err);
          if (!res.headersSent) {
            res.status(500).json({ success: false, message: '播放失败' });
          }
        });
      }
    } catch (error) {
      console.error('streamVideo error:', error);
      res.status(500).json({ success: false, message: '播放失败' });
    }
  },

  /**
   * 搜索文件（文件名、AI 标签、AI 分类、AI 摘要）
   */
  searchFiles: async (req, res) => {
    try {
      const userId = req.userId;
      const { q } = req.query;

      if (!q || !q.trim()) {
        return res.json({ success: true, files: [] });
      }

      const keyword = q.trim();
      const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

      const files = await File.find({
        owner: userId,
        isDeleted: false,
        $or: [
          { originalName: regex },
          { 'aiAnalysis.labels': regex },
          { 'aiAnalysis.category': regex },
          { 'aiAnalysis.summary': regex },
          { 'aiAnalysis.text': regex }
        ]
      }).sort({ updatedAt: -1 }).limit(50).lean();

      // 填充文件夹路径
      const folderIds = [...new Set(files.filter(f => f.folder).map(f => f.folder.toString()))];
      const folders = await Folder.find({ _id: { $in: folderIds } }).lean();
      const folderMap = {};
      folders.forEach(f => { folderMap[f._id] = f.path || '/' + f.name; });

      const result = files.map(f => ({
        id: f._id,
        name: f.originalName,
        size: f.size,
        extension: f.extension,
        mimeType: f.mimeType,
        folderId: f.folder,
        folderPath: f.folder ? (folderMap[f.folder] || '') : '',
        aiCategory: f.aiAnalysis?.category || '',
        aiSummary: f.aiAnalysis?.summary || '',
        thumb: !!f.thumb,
        isImage: ['.jpg','.jpeg','.png','.gif','.bmp','.webp'].includes(f.extension.toLowerCase()),
        isVideo: ['.mp4','.avi','.mov','.mkv','.webm'].includes(f.extension.toLowerCase()),
        createdAt: f.createdAt,
        updatedAt: f.updatedAt
      }));

      res.json({ success: true, files: result, keyword });
    } catch (error) {
      console.error('searchFiles error:', error);
      res.status(500).json({ success: false, message: '搜索失败' });
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
  },

  /**
   * 查询单个文件的 AI 分析状态（供前端轮询）
   */
  getAiStatus: async (req, res) => {
    try {
      const userId = req.userId;
      const file = await require("../models/File").findOne({
        _id: req.params.id,
        owner: userId,
        isDeleted: false
      }).lean();
      if (!file) {
        return res.status(404).json({ success: false, message: "文件不存在" });
      }
      if (file.aiAnalysis?.analyzed) {
        return res.json({ success: true, status: "done", result: {
          labels: file.aiAnalysis.labels || [],
          category: file.aiAnalysis.category || "",
          confidence: file.aiAnalysis.confidence || 0,
          summary: file.aiAnalysis.summary || ""
        }});
      }
      return res.json({ success: true, status: "pending" });
    } catch (error) {
      console.error("getAiStatus error:", error);
      res.status(500).json({ success: false, message: "查询失败" });
    }
  },

  /**
   * 选中文件或当前目录下所有未分析图片
   */
  analyzeFiles: async (req, res) => {
    try {
      const userId = req.userId;
      const { fileIds, folder } = req.body;

      const query = { owner: userId, isDeleted: false };
      if (fileIds && fileIds.length > 0) {
        query._id = { $in: fileIds };
      } else if (folder !== undefined) {
        query.folder = folder || null;
      }

      const user = await User.findById(userId);
      const quotaOk = await aiQueue.checkAiQuota(user);
      if (!quotaOk) {
        return res.status(429).json({ success: false, message: '本月 AI 分析配额已用完，请下月再试' });
      }

      const files = await File.find(query).lean();
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
      const targets = files.filter(f =>
        imageExtensions.includes(f.extension.toLowerCase()) &&
        (!f.aiAnalysis || !f.aiAnalysis.analyzed)
      );

      if (targets.length === 0) {
        return res.json({ success: true, analyzed: 0, message: '没有需要分析的文件' });
      }

      res.json({ success: true, analyzing: targets.length, message: `开始分析 ${targets.length} 个文件` });

      // 异步分析（不阻塞响应）
      const aiService = require('../services/aiService');
      const storageService = require('../services/storageService');
      let analyzed = 0;
      for (const file of targets) {
        try {
          const filePath = storageService.resolvePath(file.storage.path);
          const analysis = await aiService.analyzeImage(filePath);
          if (analysis && analysis.labels.length > 0) {
            const fileDoc = await File.findById(file._id);
            fileDoc.aiAnalysis = {
              analyzed: true, analyzedAt: new Date(),
              labels: analysis.labels, category: analysis.category,
              confidence: analysis.confidence, summary: analysis.summary || '',
              objects: analysis.objects || [], scene: analysis.scene || '',
              text: analysis.text || '',
              model: process.env.AI_MODEL || 'gpt-4o',
              promptTokens: analysis.promptTokens || 0,
              completionTokens: analysis.completionTokens || 0,
              totalTokens: analysis.totalTokens || 0
            };
            await fileDoc.save();

            // 自动归类
            if (process.env.AI_AUTO_ORGANIZE === 'true') {
              await aiQueue.autoOrganizeFile(fileDoc, analysis, userId, storageService);
            }
            analyzed++;
          }
        } catch (e) {
          console.warn('[AI] Batch analyze failed for', file._id, ':', e.message);
        }
      }
      console.log('[AI] Batch complete:', analyzed, '/', targets.length);
    } catch (error) {
      console.error('analyzeFiles error:', error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: '分析失败' });
      }
    }
  },

  /**
   * 单文件重新 AI 分析（用于预览界面"重新分析"按钮）
   * POST /files/:id/analyze
   */
  reanalyzeFile: async (req, res) => {
    try {
      const userId = req.userId || req.session?.userId;
      const file = await File.findOne({
        _id: req.params.id,
        owner: userId,
        isDeleted: false
      });
      if (!file) {
        return res.status(404).json({ success: false, message: '文件不存在' });
      }

      // 配额检查
      const user = await User.findById(userId);
      const quotaOk = await aiQueue.checkAiQuota(user);
      if (!quotaOk) {
        return res.status(429).json({ success: false, message: '本月 AI 分析配额已用完' });
      }

      // 标记为待分析
      file.aiAnalysis = { analyzed: false };
      await file.save();

      // 后台异步分析
      const storageService = require('../services/storageService');
      const aiService = require('../services/aiService');
      const ext = (file.extension || '').toLowerCase();
      const isMedia = storageService.isImage(ext) || storageService.isVideo(ext);

      if (!isMedia) {
        return res.json({ success: true, status: 'skipped', message: '非图片/视频文件' });
      }

      setImmediate(async () => {
        try {
          const filePath = storageService.resolvePath(file.storage.path);
          const analysis = storageService.isVideo(ext)
            ? await aiService.analyzeVideo(filePath)
            : await aiService.analyzeImage(filePath);

          if (analysis && analysis.labels && analysis.labels.length > 0) {
            const doc = await File.findById(file._id);
            if (doc) {
              doc.aiAnalysis = {
                analyzed: true,
                analyzedAt: new Date(),
                labels: analysis.labels,
                category: analysis.category,
                confidence: analysis.confidence,
                summary: analysis.summary || '',
                objects: analysis.objects || [],
                scene: analysis.scene || '',
                text: analysis.text || '',
                model: process.env.AI_MODEL || 'gpt-4o',
                promptTokens: analysis.promptTokens || 0,
                completionTokens: analysis.completionTokens || 0,
                totalTokens: analysis.totalTokens || 0
              };
              await doc.save();

              if (process.env.AI_AUTO_ORGANIZE === 'true') {
                try {
                  await aiQueue.autoOrganizeFile(doc, analysis, userId, storageService);
                } catch (orgErr) {
                  console.warn('[AI] Auto-organize failed:', orgErr.message);
                }
              }
              console.log('[AI] Reanalyze done:', doc._id);
            }
          } else {
            // 分析失败或无结果，标记为已完成避免一直 pending
            await File.findByIdAndUpdate(file._id, {
              'aiAnalysis.analyzed': true,
              'aiAnalysis.analyzedAt': new Date()
            });
          }
        } catch (err) {
          console.error('[AI] Reanalyze failed:', err.message);
          await File.findByIdAndUpdate(file._id, {
            'aiAnalysis.analyzed': true,
            'aiAnalysis.analyzedAt': new Date()
          }).catch(() => {});
        }
      });

      res.json({ success: true, status: 'pending' });
    } catch (error) {
      console.error('reanalyzeFile error:', error);
      res.status(500).json({ success: false, message: '启动分析失败' });
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


/**
 * 获取用户 AI 配额信息（用于前端展示）
 */
async function getAiQuota(user) {
  const limit = parseInt(process.env.AI_MONTHLY_LIMIT) || 20;
  if (user.role === 'admin' || limit === 0) {
    return { limited: false, used: 0, limit: 0, percent: 0 };
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const count = await File.countDocuments({
    owner: user._id,
    'aiAnalysis.analyzed': true,
    'aiAnalysis.analyzedAt': { $gte: monthStart }
  });

  return {
    limited: true,
    used: count,
    limit,
    percent: Math.round((count / limit) * 100)
  };
}

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