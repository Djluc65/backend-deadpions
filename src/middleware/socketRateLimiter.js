// Version In-Memory (sans Redis pour simplifier l'installation locale)
// Pour la production avec plusieurs instances, migrer vers Redis.

class SocketRateLimiter {
  constructor() {
    // Map pour stocker les compteurs: key -> { count, expiresAt }
    this.limits = new Map();
    
    // Nettoyage automatique toutes les minutes
    setInterval(() => this.cleanup(), 60 * 1000);
  }

  /**
   * Vérifie si une action est autorisée
   * @param {string} userId - ID de l'utilisateur ou Socket ID
   * @param {string} action - Type d'action (ex: 'move', 'chat')
   * @param {number} limit - Nombre max d'actions
   * @param {number} windowSeconds - Fenêtre de temps en secondes
   * @returns {Promise<boolean>} - true si autorisé, false si bloqué
   */
  async checkLimit(userId, action, limit, windowSeconds) {
    const key = `${userId}:${action}`;
    const now = Date.now();
    
    let record = this.limits.get(key);

    // Si pas d'enregistrement ou expiré, on reset
    if (!record || now > record.expiresAt) {
      record = {
        count: 0,
        expiresAt: now + (windowSeconds * 1000)
      };
    }

    // Incrémenter
    record.count++;
    this.limits.set(key, record);

    // Vérifier limite
    if (record.count > limit) {
      return false; // Bloqué
    }

    return true; // Autorisé
  }

  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.limits.entries()) {
      if (now > record.expiresAt) {
        this.limits.delete(key);
      }
    }
  }
}

module.exports = new SocketRateLimiter();
