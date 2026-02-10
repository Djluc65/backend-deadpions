const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transaction.controller');
const authMiddleware = require('../middleware/auth.middleware');

router.use(authMiddleware);

router.post('/sync', transactionController.syncTransactions);
router.get('/history', transactionController.getHistory);

module.exports = router;
