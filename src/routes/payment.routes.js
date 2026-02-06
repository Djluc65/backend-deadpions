const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const authMiddleware = require('../middleware/auth.middleware');

router.get('/packs', paymentController.getKits);
router.post('/create-intent', authMiddleware, paymentController.createPaymentIntent);
router.post('/verify', authMiddleware, paymentController.verifyPayment);

module.exports = router;
