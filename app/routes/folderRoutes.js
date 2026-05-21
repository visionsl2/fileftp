const authMiddleware = require('../middlewares/authMiddleware');
const folderController = require('../controllers/folderController');

const express = require('express');
const router = express.Router();

router.use(authMiddleware.verifyToken);

router.get('/', folderController.listFolders);
router.post('/', folderController.createFolder);
router.put('/:id', folderController.renameFolder);
router.delete('/:id', folderController.deleteFolder);

module.exports = router;