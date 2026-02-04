const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { registerValidation, loginValidation, validate } = require('../middleware/validate');
const rateLimiter = require('../middleware/rateLimiter');
const { body } = require('express-validator');

// Routes d'authentification
router.post('/register', rateLimiter.authLimiter, registerValidation, validate, authController.register);
router.post('/login', rateLimiter.authLimiter, loginValidation, validate, authController.login);
router.post('/google-login', rateLimiter.authLimiter, authController.googleLogin);

// Demande de réinitialisation - STRICT rate limit
router.post(
  '/forgot-password',
  rateLimiter.forgotPassword,
  [
    body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Email invalide')
  ],
  authController.forgotPassword
);

// Validation du token (GET)
router.get(
  '/reset-password/:token',
  authController.validateResetToken
);

// Changement du mot de passe
router.post(
  '/reset-password',
  rateLimiter.resetPassword,
  [
    body('token').notEmpty(),
    body('newPassword')
      .isLength({ min: 12 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]/)
      .withMessage('Mot de passe trop faible')
  ],
  authController.resetPassword
);

router.post('/refresh-token', authController.refreshToken);
router.get('/me', authMiddleware, authController.getMe);

module.exports = router;
