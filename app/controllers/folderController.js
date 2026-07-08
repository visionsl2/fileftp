/**
 * 文件夹控制器 (Folder Controller)
 *
 * 功能说明：
 * - 创建文件夹
 * - 重命名文件夹
 * - 删除文件夹（软删除，同时删除内部文件）
 */

const Folder = require('../models/Folder');
const File = require('../models/File');

const folderController = {
  /**
   * 获取文件夹列表
   */
  listFolders: async (req, res) => {
    try {
      const userId = req.userId || req.session?.userId;
      if (!userId) {
        return res.status(401).json({ success: false, message: '未认证' });
      }

      const folders = await Folder.find({
        owner: userId,
        isDeleted: false
      }).sort({ name: 1 });

      res.json({ success: true, data: folders });
    } catch (error) {
      console.error('listFolders error:', error);
      res.status(500).json({ success: false, message: '获取文件夹列表失败' });
    }
  },

  /**
   * 创建文件夹
   *
   * @param {string} req.body.name - 文件夹名称
   * @param {string} req.body.parent - 父文件夹ID，null表示在根目录创建
   *
   * 流程：
   * 1. 验证名称不为空
   * 2. 检查同名文件夹是否已存在
   * 3. 计算路径和深度
   * 4. 创建数据库记录
   */
  createFolder: async (req, res) => {
    try {
      const { name, parent } = req.body;
      const userId = req.userId || req.session?.userId;

      if (!userId) {
        return res.status(401).json({ success: false, message: '未认证' });
      }

      // 验证名称
      if (!name || name.trim().length === 0) {
        return res.status(400).json({ success: false, message: '文件夹名称不能为空' });
      }

      // 检查同名文件夹
      const existingFolder = await Folder.findOne({
        owner: userId,
        parent: parent || null,
        name: name.trim(),
        isDeleted: false
      });

      if (existingFolder) {
        return res.status(400).json({ success: false, message: '该文件夹已存在' });
      }

      const folder = new Folder({
        name: name.trim(),
        parent: parent || null,
        owner: userId
      });

      // 如果有父文件夹，计算路径和深度
      if (parent) {
        const parentFolder = await Folder.findOne({ _id: parent, owner: userId });
        if (parentFolder) {
          folder.path = `${parentFolder.path}/${folder.name}`;
          folder.depth = parentFolder.depth + 1;
        }
      }

      await folder.save();

      res.json({ success: true, folder });
    } catch (error) {
      console.error('createFolder error:', error);
      res.status(500).json({ success: false, message: '创建文件夹失败' });
    }
  },

  /**
   * 重命名文件夹
   *
   * @param {string} req.params.id - 文件夹ID
   * @param {string} req.body.name - 新名称
   */
  renameFolder: async (req, res) => {
    try {
      const { name } = req.body;
      const userId = req.userId || req.session?.userId;

      if (!userId) {
        return res.status(401).json({ success: false, message: '未认证' });
      }

      const folder = await Folder.findOne({
        _id: req.params.id,
        owner: userId
      });

      if (!folder) {
        return res.status(404).json({ success: false, message: '文件夹不存在' });
      }

      folder.name = name.trim();
      await folder.save();

      res.json({ success: true, folder });
    } catch (error) {
      console.error('renameFolder error:', error);
      res.status(500).json({ success: false, message: '重命名失败' });
    }
  },

  /**
   * 删除文件夹（软删除）
   *
   * 注意：删除文件夹时，内部的子文件夹和文件也会被标记为删除
   *
   * @param {string} req.params.id - 文件夹ID
   */
  deleteFolder: async (req, res) => {
    try {
      const userId = req.userId || req.session?.userId;

      if (!userId) {
        return res.status(401).json({ success: false, message: '未认证' });
      }

      const folder = await Folder.findOne({
        _id: req.params.id,
        owner: userId
      });

      if (!folder) {
        return res.status(404).json({ success: false, message: '文件夹不存在' });
      }

      // 软删除文件夹
      folder.isDeleted = true;
      await folder.save();

      // 软删除内部文件
      await File.updateMany(
        { folder: folder._id, owner: userId },
        { isDeleted: true, deletedAt: new Date() }
      );

      res.json({ success: true });
    } catch (error) {
      console.error('deleteFolder error:', error);
      res.status(500).json({ success: false, message: '删除失败' });
    }
  },

  /**
   * 合并文件夹：把源文件夹下所有文件移动到目标文件夹，删除源文件夹
   * POST /folders/:id/merge-into
   * Body: { targetFolderId: 'xxx' }
   */
  mergeFolderInto: async (req, res) => {
    try {
      const userId = req.userId || req.session?.userId;
      if (!userId) {
        return res.status(401).json({ success: false, message: '未认证' });
      }

      const sourceId = req.params.id;
      const { targetFolderId } = req.body || {};

      if (!targetFolderId) {
        return res.status(400).json({ success: false, message: '缺少目标文件夹ID' });
      }
      if (sourceId === targetFolderId) {
        return res.status(400).json({ success: false, message: '源和目标不能相同' });
      }

      // 验证源文件夹
      const source = await Folder.findOne({ _id: sourceId, owner: userId });
      if (!source) {
        return res.status(404).json({ success: false, message: '源文件夹不存在' });
      }

      // 验证目标文件夹
      const target = await Folder.findOne({ _id: targetFolderId, owner: userId });
      if (!target) {
        return res.status(404).json({ success: false, message: '目标文件夹不存在' });
      }

      // 统计源下文件数（移动前）
      const fileCount = await File.countDocuments({
        owner: userId,
        folder: sourceId,
        isDeleted: { $ne: true }
      });

      // 移动所有文件
      if (fileCount > 0) {
        await File.updateMany(
          { owner: userId, folder: sourceId, isDeleted: { $ne: true } },
          { $set: { folder: targetFolderId } }
        );
      }

      // 验证源已清空
      const remaining = await File.countDocuments({
        owner: userId, folder: sourceId, isDeleted: { $ne: true }
      });
      if (remaining > 0) {
        return res.status(500).json({
          success: false,
          message: '源文件夹未完全清空（剩余 ' + remaining + ' 个文件），未删除源'
        });
      }

      // 删除源文件夹
      await Folder.deleteOne({ _id: sourceId, owner: userId });

      res.json({
        success: true,
        movedFiles: fileCount,
        deletedFolder: source.name
      });
    } catch (error) {
      console.error('mergeFolderInto error:', error);
      res.status(500).json({ success: false, message: '合并失败' });
    }
  }
};

module.exports = folderController;