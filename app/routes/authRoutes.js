const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const rateLimiter = require('../middlewares/rateLimiter');

router.get('/login', authController.getLoginPage);
router.get('/register', authController.getRegisterPage);

router.post('/register', rateLimiter.registerLimiter, authController.register);
router.post('/login', rateLimiter.loginLimiter, authController.login);

router.get('/logout', authController.logout);
router.post('/logout', authMiddleware.verifyToken, authController.logout);

module.exports = router;