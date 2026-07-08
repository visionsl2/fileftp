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
 *
 * 规则（白名单策略）：
 * - AI 不允许创建新分类，只允许放进用户已有的根级文件夹
 * - 子分类也走同样规则：父文件夹必须已存在，子文件夹也必须已存在
 * - 父/子 任一不存在 → 文件落"其他"根级文件夹
 * - "其他"文件夹首次需要时自动创建
 * - aiAnalysis.category 字段同步覆盖为实际归类名（保持 UI 一致）
 */
// 同义词白名单：把细分类归并到通用类
const SUBFOLDER_ALIASES = {
  // 交通 - 船
  '货船': '船', '轮船': '船', '邮轮': '船', '渡轮': '船',
  '客船': '船', '油轮': '船', '渔船': '船', '游船': '船',
  '货轮': '船', '舰艇': '船', '军舰': '船', '船舶': '船',
  '汽艇': '船', '帆船': '船', '快艇': '船', '小船': '船',
  // 交通 - 车
  '货车': '车', '卡车': '卡车头', '卡车头': '卡车头',
  '电动车': '电动车', '电瓶车': '电动车',
  '摩托车': '摩托车', '机车': '摩托车',
  '自行车': '自行车', '单车': '自行车', '脚踏车': '自行车',
  '轿车': '轿车', '跑车': '跑车', '越野车': '轿车', '出租车': '轿车',
  '公共汽车': '公交车', '大巴': '公交车', '公交车': '公交车',
  // 动物
  '小猫': '猫', '小狗': '狗', '小鸡': '鸡', '小鸭': '鸭',
  '黄牛': '牛', '水牛': '牛', '奶牛': '牛',
  '公鸡': '鸡', '母鸡': '鸡',
  // 食物
  '面条': '面食', '包子': '面食', '饺子': '面食', '馒头': '面食',
  '蛋糕': '甜点', '糖果': '甜点', '巧克力': '甜点',
  // 风景
  '山峰': '山', '雪山': '山', '火山': '山', '丘陵': '山',
  '大河': '河', '小河': '河', '溪流': '河',
  // 人物
  '人像': '人', '肖像': '人', '男士': '人', '女士': '人',
  '小孩': '儿童', '宝宝': '儿童', '婴儿': '儿童',
};

// 通用词（不作为子目录）
const GENERIC_LABELS = ['风景', '其他', '通用', '自然', '场景', '室内', '室外', '人造'];

function normalizeSubLabel(label) {
  if (!label) return null;
  if (SUBFOLDER_ALIASES[label]) return SUBFOLDER_ALIASES[label];
  if (GENERIC_LABELS.includes(label)) return null;
  return label;
}

async function autoOrganizeFile(fileDoc, analysis, userId, storageService) {
  try {
    const Folder = require('../models/Folder');

    // 1. 加载白名单：用户所有根级文件夹
    let rootFolders = await Folder.find({
      owner: userId, parent: null, isDeleted: false
    });

    // 2. 确保"其他"根级文件夹存在（首次自动建）
    let otherFolder = rootFolders.find(f => f.name === '其他');
    if (!otherFolder) {
      otherFolder = new Folder({
        name: '其他', owner: userId, parent: null,
        path: '/其他', depth: 1, order: 0
      });
      await otherFolder.save();
      rootFolders.push(otherFolder);
    }

    const rawCategory = analysis.category;
    const category = rawCategory && rawCategory !== '其他' ? rawCategory : null;

    // 3. 校验 category 是否在白名单（用户根级文件夹）
    const catFolder = category ? rootFolders.find(f => f.name === category) : null;

    let targetFolderId = null;
    let actualCategory = '其他'; // 实际归类名（写回 file.aiAnalysis.category）
    let subLabel = null;

    if (catFolder) {
      // 4. 父目录命中 → 尝试匹配子文件夹
      subLabel = analysis.labels[0] && analysis.labels[0] !== category
        ? normalizeSubLabel(analysis.labels[0]) : null;

      if (subLabel && analysis.confidence >= 70) {
        const subFolder = await Folder.findOne({
          owner: userId, parent: catFolder._id, name: subLabel, isDeleted: false
        });
        if (subFolder) {
          // 子文件夹存在 → 进子目录
          targetFolderId = subFolder._id;
        } else {
          // 子文件夹不存在 → 回落父目录，**不新建**
          targetFolderId = catFolder._id;
        }
        actualCategory = catFolder.name;
      } else {
        targetFolderId = catFolder._id;
        actualCategory = catFolder.name;
      }
    } else {
      // 5. category 不在白名单 → 落"其他"，同步覆盖 aiAnalysis.category
      targetFolderId = otherFolder._id;
      actualCategory = '其他';
    }

    // 6. 重命名（保留旧逻辑）
    if (analysis.summary && /^[a-zA-Z0-9._-]+$/.test(fileDoc.originalName)) {
      const ext = fileDoc.extension;
      const baseName = analysis.summary.length > 30 ? analysis.summary.slice(0, 30) : analysis.summary;
      const cleanName = baseName.replace(/[<>:"/\|?*]/g, '').trim();
      if (cleanName) {
        fileDoc.originalName = cleanName + ext;
      }
    }

    // 7. 同步覆盖 aiAnalysis.category（保持 UI category 字段与 file.folder 一致）
    fileDoc.aiAnalysis.category = actualCategory;

    if (targetFolderId) {
      fileDoc.folder = targetFolderId;
    }
    await fileDoc.save();
    console.log('[AI] Organized:', fileDoc.originalName, '→', actualCategory + (subLabel && targetFolderId !== catFolder?._id ? '/' + subLabel : ''));
  } catch (e) {
    console.warn('[AI] Auto-organize failed:', e.message);
  }
}

module.exports = {
  checkAiQuota,
  scheduleAiAnalysis,
  autoOrganizeFile
};