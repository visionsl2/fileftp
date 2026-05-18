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
  }
};

module.exports = folderController;