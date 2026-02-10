const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');
const auth = require('../middleware/auth.middleware');

router.post('/chat', auth, aiController.chat);

module.exports = router;
