const { check, validationResult } = require('express-validator');
const User = require('../models/User');
const dns = require('dns').promises;

// Validation rules for registration
exports.registerValidation = [
  check('pseudo')
    .trim()
    .escape()
    .not()
    .isEmpty()
    .withMessage('Le pseudo est requis')
    .isLength({ min: 3 })
    .withMessage('Le pseudo doit contenir au moins 3 caractères')
    .custom(async (value) => {
      const user = await User.findOne({ pseudo: value });
      if (user) {
        throw new Error('Ce pseudo est déjà utilisé');
      }
    }),
  
  check('email')
    .trim()
    .not()
    .isEmpty()
    .withMessage('L\'adresse email est requise')
    .toLowerCase()
    .normalizeEmail()
    .matches(/^.+@.+\..+$/)
    .withMessage('Format d\'email invalide (ex: utilisateur@domaine.com)')
    .bail()
    .isEmail()
    .withMessage('Veuillez fournir une adresse email valide')
    .bail()
    .isLength({ max: 254 })
    .withMessage('L\'adresse email est trop longue')
    .custom(async (value) => {
      const user = await User.findOne({ email: value });
      if (user) {
        throw new Error('Cet email est déjà utilisé');
      }
      
      // Vérification DNS MX (Mail Exchange)
      try {
        const domain = value.split('@')[1];
        await dns.resolveMx(domain);
      } catch (error) {
        throw new Error('Le domaine de cet email est invalide ou n\'accepte pas les emails');
      }
    }),
  
  check('password')
    .isLength({ min: 6 })
    .withMessage('Le mot de passe doit contenir au moins 6 caractères')
];

// Validation rules for user update
exports.updateUserValidation = [
  check('pseudo')
    .optional()
    .trim()
    .escape()
    .isLength({ min: 3 })
    .withMessage('Le pseudo doit contenir au moins 3 caractères')
    .custom(async (value, { req }) => {
      if (!value) return true;
      const user = await User.findOne({ pseudo: value });
      if (user && user._id.toString() !== req.user.id) {
        throw new Error('Ce pseudo est déjà utilisé');
      }
    }),

  check('email')
    .optional()
    .trim()
    .normalizeEmail()
    .isEmail()
    .withMessage('Veuillez fournir une adresse email valide')
    .custom(async (value, { req }) => {
      if (!value) return true;
      const user = await User.findOne({ email: value });
      if (user && user._id.toString() !== req.user.id) {
        throw new Error('Cet email est déjà utilisé');
      }
      
      // Vérification DNS MX (Mail Exchange)
      try {
        const domain = value.split('@')[1];
        await dns.resolveMx(domain);
      } catch (error) {
        throw new Error('Le domaine de cet email est invalide ou n\'accepte pas les emails');
      }
    }),
  
  check('password')
    .optional()
    .isLength({ min: 6 })
    .withMessage('Le mot de passe doit contenir au moins 6 caractères')
];

// Validation rules for login
exports.loginValidation = [
  check('email')
    .trim()
    .not()
    .isEmpty()
    .withMessage('L\'adresse email est requise')
    .toLowerCase()
    .normalizeEmail()
    .isEmail()
    .withMessage('Veuillez fournir une adresse email valide')
    .bail(),
  
  check('password')
    .not()
    .isEmpty()
    .withMessage('Le mot de passe est requis')
];

// Validation rules for search
exports.searchValidation = [
  check('q')
    .trim()
    .escape()
    .not()
    .isEmpty()
    .withMessage('Le terme de recherche est requis')
];

// Helper to check body fields presence
function checkBody(body, fields) {
  let isValid = true;
  let missingFields = [];

  for (const field of fields) {
    if (!body[field] || body[field].toString().trim() === '') {
      isValid = false;
      missingFields.push(field);
    }
  }

  return { isValid, missingFields };
}

exports.checkBody = checkBody;

// Middleware to handle validation result
exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: errors.array()[0].msg,
      errors: errors.array() 
    });
  }
  next();
};
