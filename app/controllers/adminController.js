/**
 * 管理后台控制器
 */
const File = require('../models/File');
const User = require('../models/User');
const helpers = require('../utils/helpers');

const adminController = {
  /**
   * 管理仪表盘 — 全局 AI 用量统计
   * 仅 admin 角色可访问
   */
  dashboard: async (req, res) => {
    try {
      const user = await User.findById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).render('404', { title: '无权访问' });
      }

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      // 本月全部 AI 分析统计
      const tokenStats = await File.aggregate([
        { $match: { 'aiAnalysis.analyzed': true, 'aiAnalysis.analyzedAt': { $gte: monthStart } } },
        { $group: {
          _id: null,
          totalAnalyses: { $sum: 1 },
          totalPromptTokens: { $sum: '$aiAnalysis.promptTokens' },
          totalCompletionTokens: { $sum: '$aiAnalysis.completionTokens' },
          totalTokens: { $sum: '$aiAnalysis.totalTokens' }
        }}
      ]);
      const global = tokenStats[0] || { totalAnalyses: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0 };

      // 按用户分组统计（分析数 + token 数）
      const perUser = await File.aggregate([
        { $match: { 'aiAnalysis.analyzed': true, 'aiAnalysis.analyzedAt': { $gte: monthStart } } },
        { $group: {
          _id: '$owner',
          count: { $sum: 1 },
          promptTokens: { $sum: '$aiAnalysis.promptTokens' },
          completionTokens: { $sum: '$aiAnalysis.completionTokens' },
          totalTokens: { $sum: '$aiAnalysis.totalTokens' }
        }}
      ]);

      // 填充用户名
      const userIds = perUser.map(p => p._id);
      const users = await User.find({ _id: { $in: userIds } }, 'username role').lean();
      const userMap = {};
      users.forEach(u => { userMap[u._id] = u; });

      const userStats = perUser.map(p => ({
        username: userMap[p._id]?.username || 'unknown',
        role: userMap[p._id]?.role || 'user',
        count: p.count,
        promptTokens: p.promptTokens || 0,
        completionTokens: p.completionTokens || 0,
        totalTokens: p.totalTokens || 0
      })).sort((a, b) => b.totalTokens - a.totalTokens);

      // 总计所有用户
      const totalUsers = await User.countDocuments({ isActive: true });

      // 所有文件统计
      const totalFiles = await File.countDocuments({ isDeleted: false });
      const totalSize = await File.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: null, total: { $sum: '$size' } } }
      ]);

      res.render('admin/dashboard', {
        user,
        global,
        userStats,
        totalUsers,
        totalFiles,
        totalSize: totalSize[0]?.total || 0,
        monthlyLimit: parseInt(process.env.AI_MONTHLY_LIMIT) || 20,
        formatFileSize: helpers.formatFileSize
      });
    } catch (error) {
      console.error('Admin dashboard error:', error);
      res.status(500).send('Server error');
    }
  }
};

module.exports = adminController;
