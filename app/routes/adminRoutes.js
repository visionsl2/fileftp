const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const adminController = require('../controllers/adminController');

router.use(authMiddleware.verifyToken);
router.get('/', adminController.dashboard);

module.exports = router;
