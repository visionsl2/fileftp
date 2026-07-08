const authMiddleware = require('../middlewares/authMiddleware');
const fileController = require('../controllers/fileController');

const express = require('express');
const router = express.Router();

router.use(authMiddleware.verifyToken);

router.get('/', fileController.listFiles);
router.get('/more', fileController.loadMoreFiles);
router.get('/search', fileController.searchFiles);

// 总览页：按上传时间倒序展示所有文件（只读）
router.get('/gallery', fileController.showGallery);
router.get('/gallery/more', fileController.loadMoreGallery);

// 使用 formidable 处理上传（保留中文文件名）
router.post('/upload', fileController.uploadFiles);

router.get('/:id/ai-status', fileController.getAiStatus);
router.get('/:id/info', fileController.getFileInfo);
router.get('/:id', fileController.getFileInfo);
router.get('/:id/download', fileController.downloadFile);
router.get('/:id/thumb', fileController.getThumbnail);
router.get('/:id/preview', fileController.getPreview);
router.get('/:id/stream', fileController.streamVideo);

// 文件操作
router.patch('/:id/rename', fileController.renameFile);
router.patch('/:id/move', fileController.moveFile);
router.patch('/move-batch', fileController.moveBatchFiles);
router.patch('/:id/ai-analysis', fileController.updateAiAnalysis);
router.post('/:id/analyze', fileController.reanalyzeFile);
router.post('/analyze', fileController.analyzeFiles);

router.delete('/:id', fileController.deleteFile);

module.exports = router;