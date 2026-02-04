const express = require('express');
const router = express.Router();
const friendController = require('../controllers/friend.controller');
const authMiddleware = require('../middleware/auth.middleware');
const checkBan = require('../middleware/checkBan');
const rateLimiter = require('../middleware/rateLimiter');

router.use(authMiddleware);
router.use(checkBan);

router.post('/request', rateLimiter.socialLimiter, friendController.sendRequest);
router.get('/requests', friendController.getRequests);
router.post('/accept', friendController.acceptRequest);
router.post('/decline', friendController.declineRequest);
router.post('/cancel-latest', friendController.cancelLatestRequest);
router.delete('/:friendId', friendController.removeFriend);
router.get('/', friendController.getFriends);
router.get('/search', rateLimiter.socialLimiter, friendController.searchUsers);

module.exports = router;
