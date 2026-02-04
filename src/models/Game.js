const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  players: {
    black: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    white: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  board: [{
    row: Number,
    col: Number,
    player: { type: String, enum: ['black', 'white'] }
  }],
  currentTurn: { type: String, enum: ['black', 'white'], default: 'black' },
  status: { type: String, enum: ['waiting', 'active', 'completed'], default: 'waiting' },
  winner: { type: String, enum: ['black', 'white', null], default: null },
  winnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  betAmount: { type: Number, default: 0 },
  timeControl: { type: Number, default: null }, // Seconds per turn, null for unlimited
  mode: { type: String, enum: ['simple', 'tournament'], default: 'simple' },
  tournamentSettings: {
    totalGames: { type: Number, default: 1 },
    gameNumber: { type: Number, default: 1 },
    score: {
      black: { type: Number, default: 0 },
      white: { type: Number, default: 0 }
    }
  },
  timeouts: {
    black: { type: Number, default: 0 },
    white: { type: Number, default: 0 }
  },
  readyForNextRound: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  moves: [{
    player: String,
    row: Number,
    col: Number,
    timestamp: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

module.exports = mongoose.model('Game', gameSchema);
