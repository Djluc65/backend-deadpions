const { rateLimit } = require('express-rate-limit');
const MongoStore = require('rate-limit-mongo');

// Helper to sanitize IP (e.g., handle IPv6 properly)
const getIp = (req) => {
    // If running behind a proxy (like Nginx/Heroku), ensure 'trust proxy' is set in express
    // otherwise req.ip might be undefined or loopback.
    return req.ip || req.connection.remoteAddress || 'unknown';
};

// Store pour persistance cross-restart
const store = new MongoStore({
  uri: process.env.MONGODB_URI || process.env.URL_DB,
  collectionName: 'rateLimits',
  expireTimeMs: 60 * 60 * 1000, // 1 heure (max window used)
  options: {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }
});

const defaultKeyGenerator = (req) => getIp(req);
const strictKeyGenerator = (req) => `${getIp(req)}-${req.get('User-Agent')}`;

// 1. Global Rate Limiter (Protection DDoS basique)
exports.globalLimiter = rateLimit({
  store,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requêtes par 15min par IP (assez large pour usage normal)
  message: { message: 'Trop de requêtes, veuillez ralentir.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  keyGenerator: defaultKeyGenerator
});

// 2. Login/Register Limiter (Protection Brute Force)
exports.authLimiter = rateLimit({
  store,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 tentatives
  message: { message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  keyGenerator: strictKeyGenerator
});

// 3. Game Creation Limiter (Protection Spam Création Parties)
exports.createGameLimiter = rateLimit({
  store,
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 parties max
  message: { message: 'Vous créez trop de parties. Pause de 5 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  keyGenerator: (req) => req.user ? req.user.id : getIp(req) // Par User ID si connecté
});

// 4. Social Limiter (Friend requests, search)
exports.socialLimiter = rateLimit({
  store,
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 30, // 30 demandes/recherches
  message: { message: 'Trop d\'actions sociales. Réessayez plus tard.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  keyGenerator: (req) => req.user ? req.user.id : getIp(req)
});

// 5. Upload Limiter (Avatar)
exports.uploadLimiter = rateLimit({
  store,
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 5, // 5 uploads
  message: { message: 'Trop de mises à jour d\'avatar.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  keyGenerator: (req) => req.user ? req.user.id : getIp(req)
});

// 6. Password Reset (Existing)
exports.forgotPassword = rateLimit({
  store,
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 15, // Augmenté pour éviter les blocages en dev/test
  message: { message: 'Trop de tentatives. Réessayez dans 1 heure.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  keyGenerator: strictKeyGenerator
});

exports.resetPassword = rateLimit({
  store,
  windowMs: 60 * 60 * 1000,
  max: 15, // Augmenté pour éviter les blocages en dev/test
  message: { message: 'Trop de tentatives de changement. Réessayez dans 1 heure.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  keyGenerator: strictKeyGenerator
});
