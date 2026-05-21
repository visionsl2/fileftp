/**
 * 分享路由 (Share Routes)
 *
 * 分享功能无需登录即可访问
 */

const express = require('express');
const router = express.Router();
const shareController = require('../controllers/shareController');
const authMiddleware = require('../middlewares/authMiddleware');

// 创建分享（需要登录）
router.post('/create', authMiddleware.verifyToken, shareController.createShare);

// 访问分享（无需登录）
router.get('/:token', shareController.viewShare);

// 获取分享的文件列表
router.get('/:token/files', shareController.viewShare);

// 下载分享的文件
router.get('/:token/download/:fileId', shareController.downloadShareFile);

// 获取分享的缩略图
router.get('/:token/thumb/:fileId', shareController.getShareThumbnail);

module.exports = router;