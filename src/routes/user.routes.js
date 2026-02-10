const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/auth.middleware');
const checkBan = require('../middleware/checkBan');
const rateLimiter = require('../middleware/rateLimiter');
const upload = require('../middleware/upload');
const { searchValidation, updateUserValidation, validate } = require('../middleware/validate');

// Toutes les routes utilisateur sont protégées
router.use(authMiddleware);
router.use(checkBan);

router.get('/search', rateLimiter.socialLimiter, searchValidation, validate, userController.searchUsers);
router.get('/profile', userController.getProfile);
router.put('/profile', rateLimiter.uploadLimiter, upload.single('avatar'), updateUserValidation, validate, userController.updateUser);
router.patch('/deactivate', userController.deactivateAccount);
router.delete('/profile', userController.deleteAccount);
router.get('/:id', userController.getUserById);
router.get('/me/friends', userController.getFriends);
router.get('/status/online', userController.getOnlineUsers);

module.exports = router;
