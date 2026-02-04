const mongoose = require('mongoose');

const banSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true 
  },
  ip: { 
    type: String, 
    required: true 
  },
  reason: { 
    type: String, 
    default: 'Violation des règles' 
  },
  bannedAt: { 
    type: Date, 
    default: Date.now 
  },
  expiresAt: { 
    type: Date, 
    required: true 
  },
  bannedBy: { 
    type: String, 
    default: 'System' 
  }
});

// Index TTL pour auto-suppression des bans expirés
// Le document sera supprimé automatiquement après que expiresAt soit passé
banSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Méthode statique pour vérifier si un utilisateur ou une IP est banni
banSchema.statics.isBanned = async function(userId, ip) {
  const query = {
    $or: [
      { ip: ip },
      { user: userId }
    ],
    expiresAt: { $gt: new Date() }
  };
  
  // Si userId est null/undefined (ex: utilisateur non connecté), on ne cherche que par IP
  if (!userId) {
    delete query.$or;
    query.ip = ip;
  }

  return await this.findOne(query);
};

module.exports = mongoose.model('Ban', banSchema);