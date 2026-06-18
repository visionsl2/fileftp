const authMiddleware = require('../middlewares/authMiddleware');
const fileController = require('../controllers/fileController');

const express = require('express');
const router = express.Router();

router.use(authMiddleware.verifyToken);

router.get('/', fileController.listFiles);

// 使用 formidable 处理上传（保留中文文件名）
router.post('/upload', fileController.uploadFiles);

router.get('/:id', fileController.getFileInfo);
router.get('/:id/download', fileController.downloadFile);
router.get('/:id/thumb', fileController.getThumbnail);
router.get('/:id/preview', fileController.getPreview);
router.get('/:id/stream', fileController.streamVideo);

// 文件操作
router.patch('/:id/rename', fileController.renameFile);
router.patch('/:id/move', fileController.moveFile);
router.patch('/move-batch', fileController.moveBatchFiles);

router.delete('/:id', fileController.deleteFile);

module.exports = router;