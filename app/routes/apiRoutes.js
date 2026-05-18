const express = require('express');
const router = express.Router();
const apiController = require('../controllers/apiController');
const { verifyApiToken } = require('../middlewares/apiAuthMiddleware');
const { apiLimiter } = require('../middlewares/rateLimiter');
const { upload } = require('../middlewares/uploadMiddleware');

router.post('/auth/token', apiController.generateToken);

router.use(verifyApiToken);
router.use(apiLimiter);

router.post('/files/upload', upload.single('file'), apiController.uploadFile);

router.get('/files', apiController.listFiles);
router.get('/files/:id/info', apiController.getFileInfo);
router.get('/files/:id/download', apiController.downloadFile);
router.delete('/files/:id', apiController.deleteFile);

module.exports = router;