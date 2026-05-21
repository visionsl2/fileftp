/**
 * 分享控制器 (Share Controller)
 *
 * 功能说明：
 * - 创建分享链接
 * - 访问分享内容
 * - 下载分享的文件
 */

const Share = require('../models/Share');
const File = require('../models/File');
const Folder = require('../models/Folder');
const User = require('../models/User');
const storageService = require('../services/storageService');

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + units[i];
}

const shareController = {
  /**
   * 创建分享
   */
  createShare: async (req, res) => {
    try {
      const userId = req.userId;
      const { fileIds, expiresIn, password } = req.body;

      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ success: false, message: '请选择要分享的文件' });
      }

      // 获取第一个文件的信息作为分享名称
      const firstFile = await File.findOne({
        _id: fileIds[0],
        owner: userId,
        isDeleted: false
      });

      if (!firstFile) {
        return res.status(404).json({ success: false, message: '文件不存在' });
      }

      // 计算过期时间
      let expiresAt = null;
      if (expiresIn) {
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiresIn);
      }

      // 创建分享记录
      const share = new Share({
        type: 'file',
        targetId: firstFile._id,
        targetName: firstFile.originalName,
        shareToken: Share.generateToken(),
        password: password || null,
        expiresAt: expiresAt,
        createdBy: userId,
        fileIds: fileIds
      });

      await share.save();

      res.json({
        success: true,
        shareToken: share.shareToken
      });
    } catch (error) {
      console.error('Create share error:', error);
      res.status(500).json({ success: false, message: '创建分享失败' });
    }
  },

  /**
   * 访问分享（无需登录）
   * 渲染分享页面
   */
  viewShare: async (req, res) => {
    try {
      const { token } = req.params;
      const { password } = req.query;

      const share = await Share.findOne({ shareToken: token });

      if (!share) {
        return res.status(404).render('share/view', {
          error: '分享不存在或已失效',
          share: null,
          files: [],
          shareToken: token
        });
      }

      // 检查过期
      if (share.isExpired()) {
        return res.status(410).render('share/view', {
          error: '分享链接已过期',
          share: null,
          files: [],
          shareToken: token
        });
      }

      // 检查密码
      if (share.password && share.password !== password) {
        return res.status(401).render('share/view', {
          error: '请输入访问密码',
          share: null,
          files: [],
          shareToken: token,
          needPassword: true
        });
      }

      // 更新浏览次数
      share.viewCount += 1;
      await share.save();

      // 获取分享的文件列表
      const files = await File.find({
        _id: { $in: share.fileIds },
        isDeleted: false
      }).select('_id originalName extension size mimeType createdAt');

      // 获取创建者用户名
      const User = require('../models/User');
      const creator = await User.findById(share.createdBy);
      const creatorName = creator ? creator.username : '未知用户';

      // 渲染分享页面
      res.render('share/view', {
        share: {
          name: share.targetName,
          type: share.type,
          expiresAt: share.expiresAt,
          createdBy: creatorName,
          createdAt: share.createdAt
        },
        files: files.map(f => ({
          id: f._id,
          name: f.originalName,
          extension: f.extension,
          size: formatFileSize(f.size),
          mimeType: f.mimeType,
          createdAt: f.createdAt,
          isImage: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(f.extension.toLowerCase())
        })),
        shareToken: token,
        error: null,
        needPassword: false
      });
    } catch (error) {
      console.error('View share error:', error);
      res.status(500).render('share/view', {
        error: '获取分享内容失败',
        share: null,
        files: [],
        shareToken: ''
      });
    }
  },

  /**
   * 下载分享的文件
   */
  downloadShareFile: async (req, res) => {
    try {
      const { token, fileId } = req.params;
      const { password } = req.query;

      const share = await Share.findOne({ shareToken: token });

      if (!share) {
        return res.status(404).json({ success: false, message: '分享不存在或已失效' });
      }

      // 检查过期
      if (share.isExpired()) {
        return res.status(410).json({ success: false, message: '分享链接已过期' });
      }

      // 检查密码
      if (share.password && share.password !== password) {
        return res.status(401).json({ success: false, message: '访问密码错误', needPassword: true });
      }

      // 查找文件
      const file = await File.findOne({
        _id: fileId,
        _id: { $in: share.fileIds },
        isDeleted: false
      });

      if (!file) {
        return res.status(404).json({ success: false, message: '文件不存在' });
      }

      // 设置响应头
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
      console.error('Download share file error:', error);
      res.status(500).json({ success: false, message: '下载失败' });
    }
  },

  /**
   * 获取分享的缩略图
   */
  getShareThumbnail: async (req, res) => {
    try {
      const { token, fileId } = req.params;

      const share = await Share.findOne({ shareToken: token });

      if (!share) {
        return res.status(404).json({ success: false, message: '分享不存在' });
      }

      if (share.isExpired()) {
        return res.status(410).json({ success: false, message: '分享链接已过期' });
      }

      const file = await File.findOne({
        _id: fileId,
        _id: { $in: share.fileIds },
        isDeleted: false
      });

      if (!file) {
        return res.status(404).json({ success: false, message: '文件不存在' });
      }

      // 检查是否为图片
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
      if (!imageExtensions.includes(file.extension.toLowerCase())) {
        return res.status(400).json({ success: false, message: '不是图片文件' });
      }

      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Type', 'image/jpeg');

      // 返回缩略图或原图
      let filePath = file.storage.path;
      if (file.thumb && file.thumb.path) {
        filePath = file.thumb.path;
      }

      const readStream = storageService.createReadStream(filePath);
      readStream.pipe(res);
    } catch (error) {
      console.error('Get share thumbnail error:', error);
      res.status(500).json({ success: false, message: '获取缩略图失败' });
    }
  }
};

module.exports = shareController;