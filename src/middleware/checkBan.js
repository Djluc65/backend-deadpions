const Ban = require('../models/Ban');

module.exports = async (req, res, next) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    const userId = req.user ? req.user.id : null;

    const activeBan = await Ban.isBanned(userId, ip);

    if (activeBan) {
      return res.status(403).json({ 
        message: 'Accès refusé. Vous êtes banni temporairement.',
        reason: activeBan.reason,
        expiresAt: activeBan.expiresAt
      });
    }

    next();
  } catch (error) {
    console.error('CheckBan Error:', error);
    // En cas d'erreur DB, on laisse passer pour ne pas bloquer tout le monde (fail open)
    // ou on bloque (fail closed) selon la politique de sécurité. Ici fail open.
    next();
  }
};