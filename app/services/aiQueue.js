/**
 * AI 分析任务队列（共享 helper）
 * - 主系统上传和 API 上传共用
 * - 上传后调用 enqueueAiAnalysis 标记 + 入队
 * - 后台 setImmediate 异步分析，不阻塞上传响应
 */
const File = require('../models/File');
const User = require('../models/User');

/**
 * 检查 AI 配额
 */
async function checkAiQuota(user) {
  if (user.role === 'admin') return true;
  const limit = parseInt(process.env.AI_MONTHLY_LIMIT) || 20;
  if (limit === 0) return true;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const count = await File.countDocuments({
    owner: user._id,
    'aiAnalysis.analyzed': true,
    'aiAnalysis.analyzedAt': { $gte: monthStart }
  });

  return count < limit;
}

/**
 * 调度 AI 后台分析任务
 */
function scheduleAiAnalysis(pendingFiles) {
  if (!pendingFiles || pendingFiles.length === 0) return;

  setImmediate(async () => {
    const aiService = require('./aiService');
    const storageService = require('./storageService');

    for (const item of pendingFiles) {
      try {
        const analysis = item.isVideo
          ? await aiService.analyzeVideo(item.storagePath)
          : await aiService.analyzeImage(item.storagePath);

        if (analysis && analysis.labels && analysis.labels.length > 0) {
          const doc = await File.findById(item.fileId);
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
                await autoOrganizeFile(doc, analysis, item.userId, storageService);
              } catch (orgErr) {
                console.warn('[AI] Auto-organize failed:', orgErr.message);
              }
            }
            console.log('[AI] Background analysis done:', doc._id);
          }
        } else {
          await File.findByIdAndUpdate(item.fileId, {
            'aiAnalysis.analyzed': true,
            'aiAnalysis.analyzedAt': new Date()
          });
        }
      } catch (err) {
        console.warn('[AI] Background analysis failed for', item.fileId, ':', err.message);
        await File.findByIdAndUpdate(item.fileId, {
          'aiAnalysis.analyzed': true,
          'aiAnalysis.analyzedAt': new Date()
        }).catch(() => {});
      }
    }
  });
}

/**
 * 自动归类 + 重命名
 */
async function autoOrganizeFile(fileDoc, analysis, userId, storageService) {
  try {
    const Folder = require('../models/Folder');

    const category = analysis.category && analysis.category !== '其他' ? analysis.category : null;
    const subLabel = analysis.labels[0] && analysis.labels[0] !== category ? analysis.labels[0] : null;

    let targetFolderId = null;

    if (category) {
      let catFolder = await Folder.findOne({
        owner: userId, parent: null, name: category, isDeleted: false
      });
      if (!catFolder) {
        catFolder = new Folder({
          name: category, owner: userId, parent: null,
          path: '/' + category, depth: 1, order: 0
        });
        await catFolder.save();
      }
      targetFolderId = catFolder._id;

      if (subLabel && analysis.confidence >= 70) {
        let subFolder = await Folder.findOne({
          owner: userId, parent: catFolder._id, name: subLabel, isDeleted: false
        });
        if (!subFolder) {
          subFolder = new Folder({
            name: subLabel, owner: userId, parent: catFolder._id,
            path: '/' + category + '/' + subLabel, depth: 2, order: 0
          });
          await subFolder.save();
        }
        targetFolderId = subFolder._id;
      }
    }

    if (analysis.summary && /^[a-zA-Z0-9._-]+$/.test(fileDoc.originalName)) {
      const ext = fileDoc.extension;
      const baseName = analysis.summary.length > 30 ? analysis.summary.slice(0, 30) : analysis.summary;
      const cleanName = baseName.replace(/[<>:"/\|?*]/g, '').trim();
      if (cleanName) {
        fileDoc.originalName = cleanName + ext;
      }
    }

    if (targetFolderId) {
      fileDoc.folder = targetFolderId;
    }
    await fileDoc.save();
    console.log('[AI] Organized:', fileDoc.originalName, '→', analysis.category + (subLabel ? '/' + subLabel : ''));
  } catch (e) {
    console.warn('[AI] Auto-organize failed:', e.message);
  }
}

module.exports = {
  checkAiQuota,
  scheduleAiAnalysis,
  autoOrganizeFile
};