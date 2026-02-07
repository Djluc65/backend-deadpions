const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  pseudo: {
    type: String, 
    required: true, 
    unique: true, 
    minlength: 3, 
    maxlength: 15,
    match: /^[A-Za-z0-9]+$/
  },
  email: {
    type: String, 
    required: true, 
    unique: true,
    lowercase: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  password: { 
    type: String, 
    required: false, // Modifié pour supporter Google Auth
    minlength: 6 
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true
  },
  authProvider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local'
  },

  avatar: {
    type: String,
    default: ''
  },
  country: {
    type: String,
    default: null
  },
  coins: {
    type: Number,
    default: 50000
  },
  stats: {
    gamesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 }
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  refreshToken: {
    type: String,
    default: ''
  },
  friends: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  currentGame: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Game',
    default: null
  },
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    default: null
  },
  resetPasswordAttempts: [{
    ip: String,
    timestamp: { type: Date, default: Date.now }
  }],
  passwordHistory: [{
    hash: String,
    changedAt: { type: Date, default: Date.now }
  }],
  lastPasswordChange: {
    type: Date,
    default: null
  },
  // --- Monetization & Quotas ---
  processedPaymentIntents: {
    type: [String],
    default: []
  },
  isPremium: {
    type: Boolean,
    default: false
  },
  subscriptionEndDate: {
    type: Date,
    default: null
  },
  dailyCreatedRooms: {
    type: Number,
    default: 0
  },
  lastRoomCreationDate: {
    type: Date,
    default: null // Used to reset daily counter
  }
}, {
  timestamps: true
});

// Index pour auto-suppression des tokens expirés (TTL)
userSchema.index({ resetPasswordExpires: 1 }, { expireAfterSeconds: 0 });

// Middleware pre-save pour hacher le mot de passe avant sauvegarde
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    next();
  }
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Méthode pour vérifier le mot de passe
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);