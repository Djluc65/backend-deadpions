const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const authMiddleware = require('../middleware/auth.middleware');
const upload = require('../middleware/upload');

router.use(authMiddleware);

router.post('/upload-audio', upload.single('audio'), chatController.uploadAudio);
router.get('/conversations', chatController.getConversations);
router.get('/:friendId', chatController.getMessages);
router.post('/send', chatController.sendMessage);
router.post('/read', chatController.markAsRead);

module.exports = router;
