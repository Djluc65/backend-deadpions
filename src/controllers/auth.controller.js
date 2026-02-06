const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { checkBody } = require('../middleware/validate');
const { OAuth2Client } = require('google-auth-library');
const emailService = require('../services/emailService');
const { validationResult } = require('express-validator');
const { EARLY_ACCESS_END_DATE } = require('../config');

const RESPONSE_DELAY_MS = 300;

function delay(targetMs, startTime) {
  const elapsed = Date.now() - startTime;
  const remaining = Math.max(0, targetMs - elapsed);
  return new Promise(resolve => setTimeout(resolve, remaining));
}

// Initialiser le client OAuth Google
// NOTE: Assurez-vous d'avoir GOOGLE_CLIENT_ID dans votre fichier .env
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);


const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user._id, pseudo: user.pseudo },
    process.env.JWT_SECRET || 'your_jwt_secret_key',
    { expiresIn: '1h' }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id },
    process.env.JWT_REFRESH_SECRET || 'your_refresh_secret_key',
    { expiresIn: '36500d' } // ~100 years (unlimited)
  );
};

exports.register = async (req, res) => {
  try {
    const { pseudo, email, password } = req.body;

    // Validation simple via checkBody (en complément de express-validator)
    const { isValid, missingFields } = checkBody(req.body, ['pseudo', 'email', 'password']);
    if (!isValid) {
        return res.status(400).json({ message: `Champs manquants : ${missingFields.join(', ')}` });
    }

    // Création de l'utilisateur (le mot de passe sera haché par le middleware pre-save)
    const user = await User.create({
      pseudo,
      email,
      password,
      coins: 50000
    });

    if (user) {
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);

      user.refreshToken = refreshToken;
      await user.save();

      const isEarlyAccess = new Date() < EARLY_ACCESS_END_DATE;

      res.status(201).json({
        _id: user._id,
        pseudo: user.pseudo,
        email: user.email,
        coins: user.coins,
        avatar: user.avatar,
        country: user.country,
        stats: user.stats,
        isPremium: isEarlyAccess || user.isPremium,
        isEarlyAccess: isEarlyAccess,
        earlyAccessEndDate: isEarlyAccess ? EARLY_ACCESS_END_DATE : null,
        subscriptionEndDate: user.subscriptionEndDate,
        dailyCreatedRooms: user.dailyCreatedRooms,
        token: accessToken,
        refreshToken: refreshToken
      });
    } else {
      res.status(400).json({ message: 'Données invalides.' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

exports.forgotPassword = async (req, res) => {
  const startTime = Date.now();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await delay(RESPONSE_DELAY_MS, startTime);
      return res.status(400).json({ message: 'Email invalide' });
    }
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    const genericMessage = 'Si cet email existe, un lien de réinitialisation a été envoyé.';
    
    if (!user) {
      console.warn(`[SECURITY] Reset attempt on non-existent email: ${email} from IP: ${req.ip}`);
      await delay(RESPONSE_DELAY_MS, startTime);
      return res.json({ message: genericMessage });
    }

    const recentAttempts = user.resetPasswordAttempts.filter(
      a => Date.now() - a.timestamp < 24 * 60 * 60 * 1000
    );

    if (recentAttempts.length >= 5) {
      console.warn(`[SECURITY] User ${user.pseudo} exceeded daily reset limit`);
      await delay(RESPONSE_DELAY_MS, startTime);
      return res.json({ message: genericMessage });
    }

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedCode = crypto.createHash('sha256').update(resetCode).digest('hex');

    user.resetPasswordToken = hashedCode;
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
    user.resetPasswordAttempts.push({
      ip: req.ip,
      timestamp: Date.now()
    });

    user.resetPasswordAttempts = user.resetPasswordAttempts.filter(
      a => Date.now() - a.timestamp < 30 * 24 * 60 * 60 * 1000
    );

    await user.save();

    await emailService.sendPasswordReset(user.email, resetCode, user.pseudo);

    console.log(`[INFO] Password reset code sent to ${user.email}: ${resetCode}`);
    await delay(RESPONSE_DELAY_MS, startTime);
    return res.json({ message: genericMessage });
  } catch (error) {
    console.error('[ERROR] Forgot password:', error);
    await delay(RESPONSE_DELAY_MS, startTime);
    return res.status(500).json({ message: 'Erreur serveur. Réessayez plus tard.' });
  }
};

exports.validateResetToken = async (req, res) => {
  try {
    const { email, token } = req.body; // Changé de req.params à req.body pour inclure l'email
    
    if (!email || !token) {
      return res.status(400).json({ valid: false, message: 'Email et code requis' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      email: email.toLowerCase(),
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ valid: false, message: 'Code invalide ou expiré' });
    }
    return res.json({ valid: true, message: 'Code valide' });
  } catch (error) {
    console.error('[ERROR] Validate token:', error);
    return res.status(500).json({ valid: false, message: 'Erreur serveur' });
  }
};

exports.resetPassword = async (req, res) => {
  const startTime = Date.now();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await delay(RESPONSE_DELAY_MS, startTime);
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, token, newPassword } = req.body;
    
    if (!email || !token || !newPassword) {
        await delay(RESPONSE_DELAY_MS, startTime);
        return res.status(400).json({ message: 'Tous les champs sont requis' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      email: email.toLowerCase(),
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      await delay(RESPONSE_DELAY_MS, startTime);
      return res.status(400).json({ message: 'Code invalide ou expiré' });
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      await delay(RESPONSE_DELAY_MS, startTime);
      return res.status(400).json({ message: 'Le nouveau mot de passe doit être différent' });
    }

    if (user.passwordHistory && user.passwordHistory.length > 0) {
      const last5 = user.passwordHistory.slice(-5);
      for (const oldHash of last5) {
        const isReused = await bcrypt.compare(newPassword, oldHash.hash);
        if (isReused) {
          await delay(RESPONSE_DELAY_MS, startTime);
          return res.status(400).json({ message: 'Ce mot de passe a déjà été utilisé' });
        }
      }
    }

    if (!user.passwordHistory) user.passwordHistory = [];
    user.passwordHistory.push({
      hash: user.password,
      changedAt: new Date()
    });

    if (user.passwordHistory.length > 10) {
      user.passwordHistory = user.passwordHistory.slice(-10);
    }

    // NOTE: pre-save hook handles hashing!
    user.password = newPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    user.lastPasswordChange = new Date();

    await user.save();

    await emailService.sendPasswordChangeConfirmation(user.email, user.pseudo);

    console.log(`[INFO] Password successfully reset for ${user.email}`);
    await delay(RESPONSE_DELAY_MS, startTime);
    return res.json({ message: 'Mot de passe modifié avec succès' });
  } catch (error) {
    console.error('[ERROR] Reset password:', error);
    await delay(RESPONSE_DELAY_MS, startTime);
    return res.status(500).json({ message: 'Erreur serveur. Réessayez plus tard.' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Vérifier l'utilisateur
    const user = await User.findOne({ email });

    if (user && (await user.matchPassword(password))) {
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);

      // Sauvegarder le refresh token
      user.refreshToken = refreshToken;
      await user.save();

      const isEarlyAccess = new Date() < EARLY_ACCESS_END_DATE;

      res.json({
        _id: user._id,
        pseudo: user.pseudo,
        email: user.email,
        coins: user.coins,
        avatar: user.avatar,
        country: user.country,
        stats: user.stats,
        isPremium: isEarlyAccess || user.isPremium,
        isEarlyAccess: isEarlyAccess,
        earlyAccessEndDate: isEarlyAccess ? EARLY_ACCESS_END_DATE : null,
        subscriptionEndDate: user.subscriptionEndDate,
        dailyCreatedRooms: user.dailyCreatedRooms,
        token: accessToken,
        refreshToken: refreshToken
      });
    } else {
      res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

exports.refreshToken = async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ message: 'Refresh Token requis.' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || 'your_refresh_secret_key');
    const user = await User.findById(decoded.id);

    if (!user || user.refreshToken !== refreshToken) {
      return res.status(403).json({ message: 'Refresh Token invalide ou expiré.' });
    }

    const newAccessToken = generateAccessToken(user);
    // Optionnel : on pourrait aussi renouveler le refresh token ici pour plus de sécurité (rotation)

    res.json({
      token: newAccessToken
    });
  } catch (error) {
    console.error(error);
    res.status(403).json({ message: 'Refresh Token invalide.' });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

exports.googleLogin = async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
      return res.status(400).json({ message: "Token Google manquant." });
  }

  try {
    // Vérification du token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      // Accepte plusieurs client IDs si nécessaire (Web, Android, iOS)
      // On suppose que GOOGLE_CLIENT_ID contient l'ID Web utilisé pour la vérification backend
      audience: process.env.GOOGLE_CLIENT_ID ? process.env.GOOGLE_CLIENT_ID.split(',') : undefined,
    });
    
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    if (!email) {
        return res.status(400).json({ message: "L'email est requis pour l'inscription Google." });
    }

    // Chercher l'utilisateur par ID Google ou Email
    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    if (user) {
      // Lier le compte si nécessaire
      if (!user.googleId) {
        user.googleId = googleId;
        // On ne change pas forcément l'authProvider s'il était local, mais on ajoute le lien
        if (user.authProvider === 'local') {
             user.authProvider = 'google'; // Optionnel : indiquer que c'est maintenant lié
        }
        await user.save();
      }
    } else {
      // Création d'un nouvel utilisateur
      // Générer un pseudo unique basé sur le nom
      let basePseudo = (name || email.split('@')[0]).replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
      if (basePseudo.length < 3) basePseudo = 'User' + Math.floor(Math.random() * 1000);
      
      let pseudo = basePseudo;
      let counter = 1;
      
      // Vérifier unicité du pseudo
      while (await User.findOne({ pseudo })) {
        pseudo = `${basePseudo}${counter}`.substring(0, 15); // Max 15 chars
        counter++;
      }

      user = await User.create({
        pseudo,
        email,
        googleId,
        authProvider: 'google',
        avatar: picture || '',
        coins: 50000,
        isOnline: true
      });
    }

    // Générer les tokens JWT (Session App)
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    
    user.refreshToken = refreshToken;
    await user.save();

    res.json({
        _id: user._id,
        pseudo: user.pseudo,
        email: user.email,
        coins: user.coins,
        avatar: user.avatar,
        country: user.country,
        stats: user.stats,
        token: accessToken,
        refreshToken: refreshToken
    });

  } catch (error) {
    console.error('Google Auth Error:', error);
    res.status(401).json({ message: 'Authentification Google échouée.', error: error.message });
  }
};

