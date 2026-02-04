const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ message: 'Accès refusé. Aucun token fourni.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'e15e39008fa3d0c352910bc5e9d418591db662e276b771efd4bc318516a77bb5313bcd86f07f9b297ab076446763135494ab5386dd689c1f981c4110d4dd4d7d');
    req.user = { ...decoded, userId: decoded.id };
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token invalide.' });
  }
};

module.exports = authMiddleware;
