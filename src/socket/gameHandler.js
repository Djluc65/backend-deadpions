const Game = require('../models/Game');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { checkWinner } = require('../utils/gameLogic');
const { EARLY_ACCESS_END_DATE } = require('../config');

// Helper for transaction logging
const logTransaction = async (userId, amount, type, reason, balanceBefore, balanceAfter, metadata = {}) => {
    try {
        await Transaction.create({
            userId,
            transactionId: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type,
            amount,
            reason,
            balanceBefore,
            balanceAfter,
            status: 'COMPLETEE',
            metadata
        });
    } catch (err) {
        console.error('Failed to log transaction:', err);
    }
};

// Queues by bet amount: { 500: [], 1000: [], ... }
let queues = {};
// Map to track active games for disconnect handling: socketId -> gameId
const activePlayers = new Map();
// In-memory storage for Live games (no DB)
const liveGames = new Map();

module.exports = (io, socket) => {
  // --- Invitations & Private Games ---
  socket.on('invite_friend', async ({ recipientId, betAmount, timeControl, gameId, mode, seriesLength }) => {
    try {
      const senderId = socket.data.userId || socket.userId;
      const senderPseudo = socket.data.pseudo || 'Ami'; // Fallback if pseudo not set

      console.log(`User ${senderId} inviting ${recipientId} to game ${gameId || 'new'} (Mode: ${mode || 'simple'})`);

      // Check if recipient is online (in their room)
      const recipientRoom = io.sockets.adapter.rooms.get(recipientId);
      if (!recipientRoom || recipientRoom.size === 0) {
        socket.emit('invitation_error', 'Utilisateur hors ligne');
        return;
      }

      // Check balance (only if creating new game, or if joining requires bet?)
      // If inviting to existing game, sender already paid. Recipient needs to pay.
      // But we check recipient balance on response.
      // For sender: if new game, check balance.
      const sender = await User.findById(senderId);
      const bet = betAmount || 0;

      // Skip balance check for Live Rooms (gameId starts with 'live_')
      const isLive = gameId && typeof gameId === 'string' && gameId.startsWith('live_');

      if (!gameId && !isLive) {
          if (!sender || sender.coins < bet) {
            socket.emit('invitation_error', `Solde insuffisant (Requis: ${bet})`);
            return;
          }
      }

      // Emit invitation to recipient room
      io.to(recipientId).emit('game_invitation', {
        senderId,
        senderPseudo,
        betAmount: bet,
        timeControl,
        gameId, // Pass gameId if it exists
        mode: mode || 'simple',
        seriesLength: mode === 'tournament' ? (seriesLength || 2) : 1
      });

      socket.emit('invitation_sent');

    } catch (err) {
      console.error('Invite error:', err);
      socket.emit('invitation_error', 'Erreur lors de l\'invitation');
    }
  });

  socket.on('respond_invite', async ({ senderId, accepted, betAmount, timeControl, gameId, mode, seriesLength }) => {
      try {
          const recipientId = socket.data.userId || socket.userId;
          const recipientPseudo = socket.data.pseudo || 'Ami';
          const bet = parseInt(betAmount, 10) || 0;

          if (!accepted) {
              io.to(senderId).emit('invitation_declined', { recipientPseudo });
              return;
          }

          const recipient = await User.findById(recipientId);
          
          // Check for Live Room
          const isLive = gameId && typeof gameId === 'string' && gameId.startsWith('live_');

          if (!isLive && (!recipient || recipient.coins < bet)) {
              socket.emit('invitation_error', 'Solde insuffisant');
              io.to(senderId).emit('invitation_error', 'L\'adversaire n\'a pas assez de pièces');
              return;
          }

          // Handle Live Room Join (No DB Game)
          if (isLive) {
              const game = liveGames.get(gameId);
              if (!game) {
                  socket.emit('invitation_error', 'La salle n\'existe plus');
                  return;
              }

              // Deduct coin from recipient if betAmount > 0
                  if (game.betAmount > 0) {
                      const user = await User.findById(recipientId);
                      if (!user || user.coins < game.betAmount) {
                           socket.emit('invitation_error', 'Solde insuffisant');
                           return;
                      }
                      const oldBalance = user.coins;
                      user.coins -= game.betAmount;
                      await user.save();
                      await logTransaction(user._id, game.betAmount, 'DEBIT', 'Mise partie Live', oldBalance, user.coins, { gameId });
                      socket.emit('balance_updated', user.coins);
                  }

              // Update game state
              game.players.white = recipientId;
              
              // Get full recipient info for frontend
              const recipientData = await User.findById(recipientId).select('pseudo avatar country coins');
              
              // Join socket to room
              socket.join(gameId);
              activePlayers.set(socket.id, { gameId, userId: recipientId });

              // Notify room that player joined (Creator sees this in SalleAttenteLive)
              io.to(gameId).emit('player_joined', {
                  role: 'white',
                  player: recipientData
              });

              // Send room data to recipient so they can join SalleAttenteLive
              socket.emit('live_room_joined', {
                  gameId,
                  players: {
                      black: await User.findById(game.players.black).select('pseudo avatar country coins'),
                      white: recipientData
                  },
                  spectators: game.spectators || [],
                  betAmount: game.betAmount,
                  timeControl: game.timeControl,
                  config: game.config // Send full config
              });

              return;
          }

          // If joining existing DB game
          if (gameId) {
              const game = await Game.findById(gameId);
              if (!game || game.status !== 'waiting') {
                  socket.emit('invitation_error', 'Partie introuvable ou déjà commencée');
                  return;
              }
              
              // Deduct coin from recipient
              const recipientOldBalance = recipient.coins;
              recipient.coins -= bet;
              recipient.currentGame = game._id;
              await recipient.save();
              await logTransaction(recipient._id, bet, 'DEBIT', 'Mise partie', recipientOldBalance, recipient.coins, { gameId });
              socket.emit('balance_updated', recipient.coins);

              // Update game
              game.players.white = recipientId;
              game.status = 'active';
              await game.save();

              const sender = await User.findById(senderId); // Refresh sender info

              // Join socket
              socket.join(gameId);
              activePlayers.set(socket.id, { gameId, userId: recipientId });

              io.to(gameId).emit('game_start', {
                  gameId,
                  players: {
                      black: { 
                          id: sender._id, 
                          pseudo: sender.pseudo, 
                          avatar: sender.avatar, 
                          country: sender.country, 
                          coins: sender.coins 
                      },
                      white: { 
                          id: recipient._id, 
                          pseudo: recipient.pseudo, 
                          avatar: recipient.avatar, 
                          country: recipient.country, 
                          coins: recipient.coins 
                      }
                  },
                  currentTurn: 'black',
                  betAmount: game.betAmount,
                  timeControl: game.timeControl,
                  mode: game.mode,
                  tournamentSettings: game.tournamentSettings
              });

          } else {
              // Create NEW Game (Standard flow)
              const sender = await User.findById(senderId);
              if (!sender || sender.coins < bet) {
                  socket.emit('invitation_error', 'L\'adversaire n\'a plus assez de pièces');
                  io.to(senderId).emit('invitation_error', 'Solde insuffisant');
                  return;
              }

              // Deduct Coins
              const senderOldBalance = sender.coins;
              const recipientOldBalance = recipient.coins;

              sender.coins -= bet;
              recipient.coins -= bet;
              await sender.save();
              await recipient.save();

              await logTransaction(sender._id, bet, 'DEBIT', 'Mise création partie', senderOldBalance, sender.coins, { opponentId: recipientId });
              await logTransaction(recipient._id, bet, 'DEBIT', 'Mise rejoindre partie', recipientOldBalance, recipient.coins, { opponentId: senderId });

              // Update balances
              io.to(senderId).emit('balance_updated', sender.coins);
              socket.emit('balance_updated', recipient.coins);

              const gameMode = mode || 'simple';
              const tournamentSettings = gameMode === 'tournament' ? {
                  totalGames: seriesLength || 2,
                  gameNumber: 1,
                  score: { black: 0, white: 0 }
              } : undefined;

              // Create Game
              const newGame = await Game.create({
                  players: {
                      black: senderId,
                      white: recipientId
                  },
                  betAmount: bet,
                  timeControl: timeControl,
                  currentTurn: 'black',
                  status: 'active',
                  mode: gameMode,
                  tournamentSettings: tournamentSettings
              });

              await User.updateMany(
                  { _id: { $in: [senderId, recipientId] } },
                  { $set: { currentGame: newGame._id } }
              );

              const gameId = newGame._id.toString();

              // Get Sockets
              const senderSockets = await io.in(senderId).fetchSockets();
              const recipientSockets = await io.in(recipientId).fetchSockets();

              for (const s of senderSockets) s.join(gameId);
              for (const s of recipientSockets) s.join(gameId);
              
              if (senderSockets.length > 0) activePlayers.set(senderSockets[0].id, { gameId, userId: senderId });
              if (recipientSockets.length > 0) activePlayers.set(recipientSockets[0].id, { gameId, userId: recipientId });

              // Emit Start
              const gameStartData = {
                  gameId,
                  players: {
                      black: { 
                          id: sender._id, 
                          pseudo: sender.pseudo, 
                          avatar: sender.avatar, 
                          country: sender.country, 
                          coins: sender.coins 
                      },
                      white: { 
                          id: recipient._id, 
                          pseudo: recipient.pseudo, 
                          avatar: recipient.avatar, 
                          country: recipient.country, 
                          coins: recipient.coins 
                      }
                  },
                  currentTurn: 'black',
                  betAmount: bet,
                  timeControl,
                  mode: gameMode,
                  tournamentSettings
              };

              // Emit to game room AND individual players for redundancy
              io.to(gameId).emit('game_start', gameStartData);
              io.to(senderId).emit('game_start', gameStartData);
              io.to(recipientId).emit('game_start', gameStartData);
          }

      } catch (err) {
          console.error('Respond invite error:', err);
      }
  });

  // --- Spectator & Room Creation ---
  socket.on('create_live_room', async ({ config }) => {
      try {
          const { id: gameId, createur, parametres } = config;
          const { tempsParCoup, isTournament, tournamentGames, betAmount } = parametres;

          // Verify and deduct coins for creator if needed
          const userId = createur._id || createur.id;
          const user = await User.findById(userId);

          if (!user) {
              socket.emit('error', 'Utilisateur introuvable');
              return;
          }

          // --- Quota Check for Free Users ---
          const isEarlyAccess = new Date() < EARLY_ACCESS_END_DATE;
          
          if (!user.isPremium && !isEarlyAccess) {
              const today = new Date();
              const lastDate = user.lastRoomCreationDate ? new Date(user.lastRoomCreationDate) : null;
              
              // Reset quota if new day
              if (!lastDate || lastDate.getDate() !== today.getDate() || lastDate.getMonth() !== today.getMonth() || lastDate.getFullYear() !== today.getFullYear()) {
                  user.dailyCreatedRooms = 0;
                  user.lastRoomCreationDate = today;
              }

              if (user.dailyCreatedRooms >= 5) {
                  socket.emit('error', 'Limite quotidienne de 5 salles atteinte. Passez Premium pour un accès illimité !');
                  return;
              }

              user.dailyCreatedRooms += 1;
              // We will save user later (after coin deduction) or here if no coin deduction needed
          }

          const oldBalance = user.coins;
          if (betAmount && betAmount > 0) {
              if (user.coins < betAmount) {
                   socket.emit('error', 'Solde insuffisant pour créer la partie');
                   return;
              }
              user.coins -= betAmount;
          }
          
          await user.save();
          if (betAmount && betAmount > 0) {
              await logTransaction(user._id, betAmount, 'DEBIT', 'Création Live Room', oldBalance, user.coins, { gameId });
              socket.emit('balance_updated', user.coins);
          }

          const tournamentSettings = isTournament ? {
              totalGames: tournamentGames,
              gameNumber: 1,
              score: { black: 0, white: 0 }
          } : undefined;

          const mode = isTournament ? 'tournament' : 'live';

          liveGames.set(gameId, {
              gameId,
              players: { 
                  black: userId, 
                  white: null 
              },
              createur, // Store full creator info
              config,
              board: [],
              moves: [],
              currentTurn: 'black',
              status: 'waiting',
              betAmount: betAmount || 0,
              timeControl: tempsParCoup,
              timeouts: { black: 0, white: 0 },
              mode: mode,
              tournamentSettings,
              spectators: [] // Init spectators list
          });

          socket.join(gameId);
          socket.emit('live_room_created', config);
          console.log(`Live room created: ${gameId}`);

      } catch (err) {
          console.error('Error creating live room:', err);
          socket.emit('error', 'Erreur création salle');
      }
  });

  socket.on('get_active_live_games', async () => {
      try {
          const gamesList = [];
          for (const [gameId, game] of liveGames.entries()) {
              // Return both active and waiting games
              if (game.status === 'active' || game.status === 'waiting') {
                  const blackPlayer = await User.findById(game.players.black).select('pseudo avatar country');
                  const whitePlayer = game.players.white ? await User.findById(game.players.white).select('pseudo avatar country') : null;

                  if (blackPlayer) {
                      gamesList.push({
                          id: gameId,
                          players: {
                              black: blackPlayer,
                              white: whitePlayer
                          },
                          betAmount: game.betAmount,
                          timeControl: game.timeControl,
                          status: game.status,
                          spectatorCount: game.spectators ? game.spectators.length : 0,
                          config: game.config // Send full config for display
                      });
                  }
              }
          }
          socket.emit('active_live_games', gamesList);
      } catch (err) {
          console.error('Error fetching live games:', err);
      }
  });

  socket.on('stop_live_room', async ({ gameId }) => {
      if (liveGames.has(gameId)) {
          const game = liveGames.get(gameId);
          
          // Refund creator if game is waiting and has bet
          if (game.status === 'waiting' && game.betAmount > 0 && game.players.black) {
              try {
                  const user = await User.findById(game.players.black);
                  if (user) {
                      const oldBalance = user.coins;
                      user.coins += game.betAmount;
                      await user.save();
                      await logTransaction(user._id, game.betAmount, 'REMBOURSEMENT', 'Annulation Live Room', oldBalance, user.coins, { gameId });
                      socket.emit('balance_updated', user.coins);
                  }
              } catch (err) {
                  console.error('Error refunding live room creator:', err);
              }
          }

          liveGames.delete(gameId);
          io.to(gameId).emit('live_room_closed');
          console.log(`Live room ${gameId} stopped manually`);
      }
  });

  socket.on('join_live_room', async ({ gameId }) => {
      if (gameId && gameId.startsWith('live_')) {
          socket.join(gameId);
          console.log(`Socket ${socket.id} joined live room ${gameId}`);
          
          // If game exists in memory, send state to the joining user
          // This handles reconnection or page refresh
          const game = liveGames.get(gameId);
          if (game) {
              try {
                  const userId = socket.data.userId || socket.userId;
                  
                  // Handle "Join as Player" logic if waiting and slot available
                  if (game.status === 'waiting' && !game.players.white && userId && userId !== game.players.black) {
                       const user = await User.findById(userId);
                       
                       // Check balance for betting
                       if (game.betAmount > 0) {
                           if (!user || user.coins < game.betAmount) {
                               socket.emit('error', 'Solde insuffisant pour rejoindre la partie');
                               return;
                           }
                           // Deduct coins
                           const oldBalance = user.coins;
                           user.coins -= game.betAmount;
                           await user.save();
                           await logTransaction(user._id, game.betAmount, 'DEBIT', 'Mise partie Live', oldBalance, user.coins, { gameId });
                           socket.emit('balance_updated', user.coins);
                       }

                       // Assign as White Player
                       game.players.white = userId;
                       
                       // Emit to room that a player joined
                       io.to(gameId).emit('player_joined', {
                           role: 'white',
                           player: {
                               id: user._id,
                               pseudo: user.pseudo,
                               avatar: user.avatar,
                               country: user.country,
                               coins: user.coins
                           }
                       });
                       
                       // Emit to the joiner that they successfully joined as player
                       socket.emit('live_room_joined', { 
                           role: 'white',
                           config: game.config,
                           players: {
                               black: await User.findById(game.players.black).select('pseudo avatar country coins'),
                               white: user
                           }
                       });
                       
                       console.log(`User ${userId} assigned as White in live game ${gameId} (Bet: ${game.betAmount})`);
                  }
                  // If just a spectator or already in game
                  else if (game.status === 'waiting') {
                       // If user is the creator (Black) or the opponent (White) rejoining
                       if (userId === game.players.black || userId === game.players.white) {
                           // Just send current room state
                           // We might want to send 'live_room_joined' too so they see the waiting screen
                           const black = await User.findById(game.players.black).select('pseudo avatar country coins');
                           const white = game.players.white ? await User.findById(game.players.white).select('pseudo avatar country coins') : null;
                           
                           socket.emit('live_room_joined', { 
                               role: userId === game.players.black ? 'black' : 'white',
                               config: game.config,
                               players: { black, white },
                               spectators: game.spectators
                           });
                       } else {
                           // Spectator
                           socket.emit('spectator_list_updated', game.spectators || []);
                       }
                  }

                  // Only emit game_start if the game is actually active
                  if (game.status === 'active') {
                      const sender = await User.findById(game.players.black);
                      const recipient = await User.findById(game.players.white);
                      
                      socket.emit('game_start', {
                          gameId,
                          players: {
                              black: sender ? { 
                                  id: sender._id, 
                                  pseudo: sender.pseudo, 
                                  avatar: sender.avatar, 
                                  country: sender.country, 
                                  coins: sender.coins 
                              } : null,
                              white: recipient ? { 
                                  id: recipient._id, 
                                  pseudo: recipient.pseudo, 
                                  avatar: recipient.avatar, 
                                  country: recipient.country, 
                                  coins: recipient.coins 
                              } : null
                          },
                          currentTurn: game.currentTurn,
                          board: game.board,
                          betAmount: game.betAmount,
                          timeControl: game.timeControl,
                          mode: game.mode,
                          tournamentSettings: game.tournamentSettings,
                          roomConfig: game.config
                      });
                  }

                  // Re-register in activePlayers for disconnect handling
                  if (userId) {
                      activePlayers.set(socket.id, { gameId, userId });
                  }
              } catch (err) {
                  console.error('Error fetching players for live game rejoin:', err);
              }
          }
      }
  });

  socket.on('start_live_game', async ({ gameId }) => {
    try {
        const game = liveGames.get(gameId);
        if (!game) {
            socket.emit('error', 'Partie introuvable');
            return;
        }

        // Validate creator
        const userId = socket.data.userId || socket.userId;
        if (game.players.black.toString() !== userId) {
             socket.emit('error', 'Seul le créateur peut lancer la partie');
             return;
        }

        // Validate opponent presence
        if (!game.players.white) {
             socket.emit('error', 'Attendez un adversaire avant de lancer');
             return;
        }

        // Update status
        game.status = 'active';
        
        // Fetch full player objects
        const blackPlayer = await User.findById(game.players.black);
        const whitePlayer = await User.findById(game.players.white);

        io.to(gameId).emit('game_start', {
            gameId,
            players: {
                black: blackPlayer,
                white: whitePlayer
            },
            currentTurn: 'black',
            betAmount: game.betAmount,
            timeControl: game.timeControl,
            mode: 'live',
            tournamentSettings: game.tournamentSettings,
            roomConfig: game.config
        });
        
        console.log(`Live game ${gameId} started by ${userId}`);

    } catch (err) {
        console.error('Error starting live game:', err);
    }
  });

  socket.on('create_room', async ({ betAmount, timeControl, mode, seriesLength }) => {
      try {
          const userId = socket.data.userId || socket.userId;
          const user = await User.findById(userId);

          if (!user || user.coins < betAmount) {
              socket.emit('error', 'Solde insuffisant');
              return;
          }

          const oldBalance = user.coins;
          user.coins -= betAmount;
          await user.save();
          await logTransaction(user._id, betAmount, 'DEBIT', 'Création partie personnalisée', oldBalance, user.coins, {});
          socket.emit('balance_updated', user.coins);

          const gameMode = mode || 'simple';
          const tournamentSettings = gameMode === 'tournament' ? {
              totalGames: seriesLength || 2,
              gameNumber: 1,
              score: { black: 0, white: 0 }
          } : undefined;

          const newGame = await Game.create({
              players: {
                  black: userId
              },
              betAmount: betAmount,
              timeControl: timeControl,
              currentTurn: 'black',
              status: 'waiting',
              mode: gameMode,
              tournamentSettings: tournamentSettings
          });

          // Update user's current game
          user.currentGame = newGame._id;
          await user.save();

          const gameId = newGame._id.toString();
          socket.join(gameId);
          activePlayers.set(socket.id, { gameId, userId });

          socket.emit('room_created', {
              gameId,
              betAmount,
              timeControl,
              mode: gameMode,
              tournamentSettings,
              players: {
                  black: { 
                      id: user._id, 
                      pseudo: user.pseudo, 
                      avatar: user.avatar, 
                      country: user.country, 
                      coins: user.coins 
                  }
              }
          });

      } catch (err) {
          console.error('Create room error:', err);
          socket.emit('error', 'Erreur création salle');
      }
  });

  socket.on('join_custom_game', async ({ gameId }) => {
      try {
          const userId = socket.data.userId || socket.userId;
          const user = await User.findById(userId);
          const game = await Game.findById(gameId);

          if (!game) {
              socket.emit('error', 'Partie introuvable');
              return;
          }

          // Allow rejoining if user is already a player in the game
          if (game.players.black.toString() === userId || (game.players.white && game.players.white.toString() === userId)) {
              socket.join(gameId);
              activePlayers.set(socket.id, { gameId, userId });
              console.log(`User ${userId} rejoined game ${gameId}`);
              
              // Send current game state to the rejoining player
              const blackPlayer = await User.findById(game.players.black);
              const whitePlayer = game.players.white ? await User.findById(game.players.white) : null;
              
              socket.emit('game_rejoined', {
                  gameId,
                  players: {
                      black: blackPlayer,
                      white: whitePlayer
                  },
                  currentTurn: game.currentTurn,
                  betAmount: game.betAmount,
                  timeControl: game.timeControl,
                  mode: game.mode,
                  tournamentSettings: game.tournamentSettings,
                  board: game.board
              });
              return;
          }

          if (game.status !== 'waiting') {
              socket.emit('error', 'Partie déjà commencée');
              return;
          }

          if (user.coins < game.betAmount) {
              socket.emit('error', 'Solde insuffisant');
              return;
          }

          const oldBalance = user.coins;
          user.coins -= game.betAmount;
          user.currentGame = game._id;
          await user.save();
          await logTransaction(user._id, game.betAmount, 'DEBIT', 'Rejoindre partie personnalisée', oldBalance, user.coins, { gameId });
          socket.emit('balance_updated', user.coins);

          game.players.white = userId;
          game.status = 'active';
          await game.save();

          socket.join(gameId);
          activePlayers.set(socket.id, { gameId, userId });

          const player1 = await User.findById(game.players.black);

          io.to(gameId).emit('game_start', {
              gameId,
              players: {
                  black: { 
                      id: player1._id, 
                      pseudo: player1.pseudo, 
                      avatar: player1.avatar, 
                      country: player1.country, 
                      coins: player1.coins 
                  },
                  white: { 
                      id: user._id, 
                      pseudo: user.pseudo, 
                      avatar: user.avatar, 
                      country: user.country, 
                      coins: user.coins 
                  }
              },
              currentTurn: 'black',
              betAmount: game.betAmount,
              timeControl: game.timeControl,
              mode: game.mode,
              tournamentSettings: game.tournamentSettings
          });

      } catch (err) {
          console.error('Join custom game error:', err);
      }
  });

  socket.on('quit_waiting_room', async ({ gameId, userId }) => {
      try {
          const game = await Game.findById(gameId);
          if (!game) {
              socket.emit('error', 'Partie introuvable');
              return;
          }

          if (game.status !== 'waiting') {
              socket.emit('error', 'Impossible de quitter : la partie n\'est pas en attente');
              return;
          }

          // Verify ownership (only creator/black player can close the room)
          if (game.players.black.toString() !== userId) {
              socket.emit('error', 'Non autorisé');
              return;
          }

          // Refund user
          const user = await User.findById(userId);
          if (user) {
              const oldBalance = user.coins;
              user.coins += game.betAmount;
              user.currentGame = null;
              await user.save();
              await logTransaction(user._id, game.betAmount, 'REMBOURSEMENT', 'Annulation partie personnalisée', oldBalance, user.coins, { gameId });
              socket.emit('balance_updated', user.coins);
          }

          // Delete the game since it never started
          await Game.deleteOne({ _id: gameId });

          socket.leave(gameId);
          activePlayers.delete(socket.id);

          socket.emit('waiting_room_closed');
          console.log(`Waiting room ${gameId} closed by ${userId}, refunded ${game.betAmount}`);

      } catch (err) {
          console.error('Quit waiting room error:', err);
          socket.emit('error', 'Erreur lors de l\'annulation');
      }
  });

  socket.on('join_spectator', async ({ gameId }) => {
      try {
          // Check if it's a Live Game (in-memory)
          if (gameId && gameId.startsWith('live_')) {
              const game = liveGames.get(gameId);
              if (!game) {
                  socket.emit('error', 'Partie live introuvable');
                  return;
              }

              socket.join(gameId);

              // Add to spectators list
              const userId = socket.data.userId || socket.userId;
              if (userId) {
                  const user = await User.findById(userId);
                  if (user) {
                      const spectatorInfo = {
                          id: user._id,
                          pseudo: user.pseudo,
                          avatar: user.avatar,
                          country: user.country
                      };
                      
                      // Avoid duplicates
                      if (!game.spectators) game.spectators = [];
                      const exists = game.spectators.some(s => s.id.toString() === user._id.toString());
                      if (!exists) {
                          game.spectators.push(spectatorInfo);
                      }
                      
                      // Broadcast updated list to everyone in the room
                      io.to(gameId).emit('spectator_list_updated', game.spectators);
                  }
              }

              // Fetch player details
              const blackPlayer = await User.findById(game.players.black).select('pseudo avatar country coins');
              const whitePlayer = await User.findById(game.players.white).select('pseudo avatar country coins');

              // Send current state
              socket.emit('spectator_joined', {
                    gameId,
                    board: game.board,
                    players: {
                        black: blackPlayer ? { id: blackPlayer._id, ...blackPlayer.toObject() } : null,
                        white: whitePlayer ? { id: whitePlayer._id, ...whitePlayer.toObject() } : null
                    },
                    currentTurn: game.currentTurn,
                    betAmount: game.betAmount,
                    timeControl: game.timeControl,
                    timeouts: game.timeouts,
                    moves: game.moves,
                    winner: null // Live games might not have winner set in memory properly yet if active
                });
              return;
          }

          // Database Game
          const game = await Game.findById(gameId)
              .populate('players.black', 'pseudo avatar country coins')
              .populate('players.white', 'pseudo avatar country coins');
              
          if (!game) {
              socket.emit('error', 'Partie introuvable');
              return;
          }

          socket.join(gameId);
          // Don't add to activePlayers as they are not playing

          // Send current state
          socket.emit('spectator_joined', {
                gameId,
                board: game.board,
                players: game.players,
                currentTurn: game.currentTurn,
                betAmount: game.betAmount,
                timeControl: game.timeControl,
                timeouts: game.timeouts,
                moves: game.moves,
                winner: game.winner
            });

      } catch (err) {
          console.error('Spectator error:', err);
      }
  });

  socket.on('get_game_details', async ({ gameId }) => {
    try {
        const game = await Game.findById(gameId);
        if (!game) {
            socket.emit('game_details', { error: 'Game not found' });
            return;
        }
        
        // Find if user is creator/player to return correct player info? 
        // Actually just return general info needed for Join/Spectate decision
        
        socket.emit('game_details', {
            gameId: game._id,
            status: game.status,
            betAmount: game.betAmount,
            timeControl: game.timeControl,
            players: game.players
        });
    } catch (err) {
        console.error('Get game details error:', err);
        socket.emit('game_details', { error: 'Server error' });
    }
  });

  // --- Chat ---
  socket.on('MESSAGE_TEXTE', ({ matchId, message, senderId, senderPseudo, id }) => {
      socket.to(matchId).emit('MESSAGE_TEXTE', { message, senderId, senderPseudo, id });
  });

  socket.on('MESSAGE_EMOJI', ({ matchId, emoji, senderId, senderPseudo, id }) => {
      socket.to(matchId).emit('MESSAGE_EMOJI', { emoji, senderId, senderPseudo, id });
  });

  // --- Matchmaking ---
  socket.on('find_game', async (userData) => {
    // userData: { id, pseudo, betAmount, timeControl, mode, seriesLength }
    const { id: userId, pseudo, betAmount: rawBetAmount, timeControl, mode, seriesLength } = userData;
    const betAmount = parseInt(rawBetAmount, 10);
    const gameMode = mode || 'simple';
    const gameSeriesLength = gameMode === 'tournament' ? (seriesLength || 2) : 1;

    const queueKey = `${betAmount}_${timeControl === undefined || timeControl === null ? 'unlimited' : timeControl}_${gameMode}_${gameSeriesLength}`;

    console.log(`User ${pseudo} looking for game with bet ${betAmount}, timeControl: ${timeControl}, mode: ${gameMode}, series: ${gameSeriesLength}`);

    try {
      // 1. Check Balance
      const user = await User.findById(userId);
      if (!user) {
        socket.emit('error', 'User not found');
        return;
      }

      console.log(`User ${pseudo} (coins: ${user.coins}) trying to bet ${betAmount}`);

      if (user.coins < betAmount) {
        console.log(`Insufficient balance: ${user.coins} < ${betAmount}`);
        socket.emit('error', `Insufficient balance (Has: ${user.coins}, Required: ${betAmount})`);
        return;
      }

      // 2. Deduct Coins (Lock funds)
      const oldBalance = user.coins;
      user.coins -= betAmount;
      await user.save();
      
      await logTransaction(user._id, betAmount, 'DEBIT', 'Mise matchmaking', oldBalance, user.coins, { queueKey });

      // Notify client of new balance
      socket.emit('balance_updated', user.coins);

      // 3. Add to Queue
      if (!queues[queueKey]) {
        queues[queueKey] = [];
      }

      // Attach userId to socket for easier lookup later (e.g. rematch)
      socket.data.userId = userId;
      socket.data.pseudo = pseudo;

      // Check if already in queue (prevent double charge/queue)
      const existingIndex = queues[queueKey].findIndex(p => p.userId === userId);
      if (existingIndex !== -1) {
        // Already in queue? Maybe just update socketId
        queues[queueKey][existingIndex].socketId = socket.id;
      } else {
        queues[queueKey].push({ 
          socketId: socket.id, 
          userId, 
          pseudo, 
          timeControl,
          avatar: user.avatar,
          country: user.country,
          coins: user.coins
        });
      }

      console.log(`Queue for ${queueKey}: ${queues[queueKey].length} players`);

      // 4. Check for Match
      if (queues[queueKey].length >= 2) {
        const player1 = queues[queueKey].shift();
        const player2 = queues[queueKey].shift();

        // Ensure distinct players (safety check)
        if (player1.userId === player2.userId) {
          queues[queueKey].push(player1); // Put back
          return;
        }

        // Create Game
        const tournamentSettings = gameMode === 'tournament' ? {
            totalGames: gameSeriesLength,
            gameNumber: 1,
            score: { black: 0, white: 0 }
        } : undefined;

        const newGame = await Game.create({
          players: {
            black: player1.userId,
            white: player2.userId
          },
          betAmount: betAmount,
          timeControl: timeControl, // Store time control
          currentTurn: 'black',
          status: 'active',
          mode: gameMode,
          tournamentSettings: tournamentSettings
        });

        await User.updateMany(
            { _id: { $in: [player1.userId, player2.userId] } },
            { $set: { currentGame: newGame._id } }
        );

        const gameId = newGame._id.toString();

        // Join Rooms
        const socket1 = io.sockets.sockets.get(player1.socketId);
        const socket2 = io.sockets.sockets.get(player2.socketId);

        if (socket1) socket1.join(gameId);
        if (socket2) socket2.join(gameId);

        // Track active players
        activePlayers.set(player1.socketId, { gameId, userId: player1.userId });
        activePlayers.set(player2.socketId, { gameId, userId: player2.userId });

        // Notify Start
        io.to(gameId).emit('game_start', {
          gameId,
          players: {
            black: { 
              id: player1.userId, 
              pseudo: player1.pseudo,
              avatar: player1.avatar,
              country: player1.country,
              coins: player1.coins
            },
            white: { 
              id: player2.userId, 
              pseudo: player2.pseudo,
              avatar: player2.avatar,
              country: player2.country,
              coins: player2.coins
            }
          },
          currentTurn: 'black',
          betAmount,
          timeControl, // Send back to clients
          mode: gameMode,
          tournamentSettings: tournamentSettings
        });

        console.log(`Game started: ${gameId} (${betAmount} coins, time: ${timeControl}, mode: ${gameMode})`);
      } else {
        socket.emit('waiting_for_opponent');
      }

    } catch (err) {
      console.error('Error in find_game:', err);
      socket.emit('error', 'Matchmaking error');
    }
  });

  socket.on('cancel_search', async (userData) => {
    const { id: userId, betAmount: rawBetAmount, timeControl, mode, seriesLength } = userData;
    const betAmount = parseInt(rawBetAmount, 10);
    const gameMode = mode || 'simple';
    const gameSeriesLength = gameMode === 'tournament' ? (seriesLength || 2) : 1;
    
    const queueKey = `${betAmount}_${timeControl === undefined || timeControl === null ? 'unlimited' : timeControl}_${gameMode}_${gameSeriesLength}`;
    
    if (queues[queueKey]) {
      const index = queues[queueKey].findIndex(p => p.userId === userId);
      if (index !== -1) {
        queues[queueKey].splice(index, 1);

        
        // Refund Coins
        try {
          const user = await User.findById(userId);
          if (user) {
                const oldBalance = user.coins;
                user.coins += betAmount;
                await user.save();
                await logTransaction(user._id, betAmount, 'REMBOURSEMENT', 'Annulation recherche', oldBalance, user.coins, {});
                socket.emit('balance_updated', user.coins);
                socket.emit('search_cancelled');
                console.log(`User ${userId} refunded ${betAmount}`);
              }
        } catch (err) {
          console.error('Refund error:', err);
        }
      }
    }
  });

  // --- Game Moves ---
  socket.on('make_move', async ({ gameId, row, col, player, isAutoPlay }) => {
    try {
      const isLive = gameId && typeof gameId === 'string' && gameId.startsWith('live_');
      let game;

      if (isLive) {
          game = liveGames.get(gameId);
      } else {
          game = await Game.findById(gameId);
      }

      if (!game) return;

      if (game.status !== 'active') {
        socket.emit('error', 'Game is not active');
        return;
      }
      if (game.currentTurn !== player) {
        socket.emit('error', 'Not your turn');
        return;
      }

      // Check occupancy
      if (game.board.some(s => s.row === row && s.col === col)) {
        socket.emit('error', 'Cell occupied');
        return;
      }

      // Update Game
      game.board.push({ row, col, player });
      game.moves.push({ player, row, col });
      
      let newAutoPlayCount = undefined;

      // Handle AutoPlay Timeout Logic
      if (isAutoPlay) {
          if (!game.timeouts) game.timeouts = { black: 0, white: 0 };
          game.timeouts[player] = (game.timeouts[player] || 0) + 1;
          newAutoPlayCount = game.timeouts[player];
          
          if (newAutoPlayCount >= 5) {
              // FORFEIT due to too many timeouts
              game.status = 'completed';
              // The OTHER player wins
              const winner = player === 'black' ? 'white' : 'black';
              game.winner = winner;
              const winnerId = winner === 'black' ? game.players.black : game.players.white;
              game.winnerId = winnerId;
              
              if (isLive) {
                // For Live Games, only delete if creator resigns? 
                // Actually, if resign, players are still there. We should NOT delete the room.
                // We just record the result of this game.
                // So we do NOTHING here regarding deletion.
            } else {
                await game.save();
            } // Cleanup live game

              if (!isLive) {
                  // Clear currentGame for both players
                  await User.updateMany(
                      { _id: { $in: [game.players.black, game.players.white] } },
                      { $set: { currentGame: null } }
                  );

                  // Handle Rewards (Same as standard win)
                  const bet = game.betAmount;
                  const totalPot = bet * 2;
                  const winnerGain = Math.floor(totalPot * 0.9);
                  
                  // Update Players
                  const winnerUser = await User.findById(winnerId);
                  if (winnerUser) {
                    const oldBalance = winnerUser.coins;
                    winnerUser.coins += winnerGain;
                    winnerUser.stats.wins += 1;
                    winnerUser.stats.gamesPlayed += 1;
                    await winnerUser.save();
                    await logTransaction(winnerUser._id, winnerGain, 'CREDIT', 'Gain victoire (forfait)', oldBalance, winnerUser.coins, { gameId, reason: 'timeout' });
                    io.to(activePlayers.get(socket.id)?.socketId || socket.id).emit('balance_updated', winnerUser.coins);
                  }

                  const loserId = winner === 'black' ? game.players.white : game.players.black;
                  const loserUser = await User.findById(loserId);
                  if (loserUser) {
                    loserUser.stats.losses += 1;
                    loserUser.stats.gamesPlayed += 1;
                    await loserUser.save();
                  }
              }
              
              // Clear active players
              for (const [sId, data] of activePlayers.entries()) {
                  if (data.gameId === gameId) activePlayers.delete(sId);
              }

              io.to(gameId).emit('game_over', {
                winner,
                winnerId,
                gains: isLive ? 0 : (game.betAmount * 2 * 0.9),
                reason: 'timeout',
                timeouts: game.timeouts[player],
                updatedCoins: !isLive ? {
                    [winnerId]: winnerUser.coins,
                    [loserId]: loserUser.coins
                } : undefined
              });
              return;
          }
      }

      // Check Winner (Standard)
      const winner = checkWinner(game.board, { row, col, player });
      
      if (winner) {
        // Emit the final move so clients can see the winning pawn
        io.to(gameId).emit('move_made', {
          row, col, player,
          nextTurn: null,
          newAutoPlayCount: undefined
        });

        // --- TOURNAMENT LOGIC START ---
        if (game.mode === 'tournament' && game.tournamentSettings) {
            const winnerColor = winner;
            const loserColor = winnerColor === 'black' ? 'white' : 'black';
            
            // Update Score
            game.tournamentSettings.score[winnerColor] += 1;
            if (!isLive) game.markModified('tournamentSettings');
            
            const totalGames = game.tournamentSettings.totalGames;
            const winsNeeded = Math.floor(totalGames / 2) + 1;
            const currentScore = game.tournamentSettings.score[winnerColor];
            const gamesPlayed = game.tournamentSettings.gameNumber;
            
            let seriesOver = false;
            let seriesWinner = null;
            let seriesReason = null; // 'victory', 'draw'

            if (currentScore >= winsNeeded) {
                seriesOver = true;
                seriesWinner = winnerColor;
                seriesReason = 'victory';
            } else if (gamesPlayed >= totalGames) {
                seriesOver = true;
                seriesWinner = null; // Draw
                seriesReason = 'draw';
            }

            if (seriesOver) {
                game.status = 'completed';
                game.winner = seriesWinner; // null if draw
                
                let winnerId = null;
                if (seriesWinner) {
                    winnerId = seriesWinner === 'black' ? game.players.black : game.players.white;
                    game.winnerId = winnerId;
                }

                if (!isLive) await game.save();
                else liveGames.delete(gameId);

                if (!isLive) {
                    // Clear currentGame
                    await User.updateMany(
                        { _id: { $in: [game.players.black, game.players.white] } },
                        { $set: { currentGame: null } }
                    );

                    // Handle Rewards
                    const bet = game.betAmount;
                    const totalPot = bet * 2;
                    const winnerGain = Math.floor(totalPot * 0.9);

                    if (seriesWinner) {
                        // Winner gets pot
                        const winnerUser = await User.findById(winnerId);
                        if (winnerUser) {
                            winnerUser.coins += winnerGain;
                            winnerUser.stats.wins += 1;
                            winnerUser.stats.gamesPlayed += 1;
                            await winnerUser.save();
                            // Find socket to update balance
                            for (const [sId, data] of activePlayers.entries()) {
                                if (data.userId === winnerId.toString()) {
                                     io.to(sId).emit('balance_updated', winnerUser.coins);
                                }
                            }
                        }
                        
                        const loserId = seriesWinner === 'black' ? game.players.white : game.players.black;
                        const loserUser = await User.findById(loserId);
                        if (loserUser) {
                            loserUser.stats.losses += 1;
                            loserUser.stats.gamesPlayed += 1;
                            await loserUser.save();
                             // Find socket to update balance
                            for (const [sId, data] of activePlayers.entries()) {
                                if (data.userId === loserId.toString()) {
                                     io.to(sId).emit('balance_updated', loserUser.coins);
                                }
                            }
                        }
                    } else {
                        // DRAW - Refund bets (or split pot?)
                        // Usually draw = refund original bet
                        const p1 = await User.findById(game.players.black);
                        const p2 = await User.findById(game.players.white);
                        
                        if (p1) {
                            p1.coins += bet;
                            p1.stats.gamesPlayed += 1; // Draw counts as played?
                            await p1.save();
                            for (const [sId, data] of activePlayers.entries()) {
                                if (data.userId === p1._id.toString()) io.to(sId).emit('balance_updated', p1.coins);
                            }
                        }
                        if (p2) {
                            p2.coins += bet;
                            p2.stats.gamesPlayed += 1;
                            await p2.save();
                            for (const [sId, data] of activePlayers.entries()) {
                                if (data.userId === p2._id.toString()) io.to(sId).emit('balance_updated', p2.coins);
                            }
                        }
                    }
                }

                // Clean active players
                activePlayers.delete(socket.id);
                for (const [sId, data] of activePlayers.entries()) {
                    if (data.gameId === gameId) activePlayers.delete(sId);
                }

                io.to(gameId).emit('tournament_over', {
                    winner: seriesWinner,
                    winnerId: winnerId,
                    score: game.tournamentSettings.score,
                    reason: seriesReason,
                    gains: isLive ? 0 : (seriesWinner ? Math.floor(game.betAmount * 2 * 0.9) : game.betAmount), // Gain displayed
                    updatedCoins: (!isLive && seriesWinner) ? {
                        [winnerId]: winnerUser.coins,
                        [loserId]: loserUser.coins
                    } : (!isLive && !seriesWinner) ? {
                        [game.players.black]: p1.coins,
                        [game.players.white]: p2.coins
                    } : undefined
                });

            } else {
                // Series Continues
                game.tournamentSettings.gameNumber += 1;
                game.board = [];
                game.moves = [];
                game.timeouts = { black: 0, white: 0 };
                game.readyForNextRound = []; // Reset ready players

                // Swap start player? Usually yes.
                // Game 1: Black (Start). Game 2: White (Start).
                // If gameNumber is even (2, 4...), White starts.
                // If gameNumber is odd (3, 5...), Black starts.
                const nextGameNumber = game.tournamentSettings.gameNumber;
                game.currentTurn = nextGameNumber % 2 === 0 ? 'white' : 'black';
                
                if (!isLive) {
                    game.markModified('tournamentSettings');
                    game.markModified('board');
                    game.markModified('moves');
                    game.markModified('timeouts');
                    game.markModified('readyForNextRound');
                    await game.save();
                }

                io.to(gameId).emit('round_over', {
                    winner: winnerColor,
                    score: game.tournamentSettings.score,
                    nextGameNumber,
                    nextTurn: null // Wait for both players to be ready
                });
            }
            return; // Exit make_move
        }
        // --- TOURNAMENT LOGIC END ---

        game.status = 'completed';
        game.winner = winner;
        const winnerId = winner === 'black' ? game.players.black : game.players.white;
        game.winnerId = winnerId;
        
        if (!isLive) await game.save();
        else liveGames.delete(gameId);

        if (!isLive) {
            // Clear currentGame for both players
            await User.updateMany(
                { _id: { $in: [game.players.black, game.players.white] } },
                { $set: { currentGame: null } }
            );

            // Handle Rewards
            const bet = game.betAmount;
            const totalPot = bet * 2;
            const winnerGain = Math.floor(totalPot * 0.9); // 90%
            
            // Update Players
            const winnerUser = await User.findById(winnerId);
            if (winnerUser) {
            winnerUser.coins += winnerGain;
            winnerUser.stats.wins += 1;
            winnerUser.stats.gamesPlayed += 1;
            await winnerUser.save();
            socket.emit('balance_updated', winnerUser.coins);
            }

            const loserId = winner === 'black' ? game.players.white : game.players.black;
            const loserUser = await User.findById(loserId);
            if (loserUser) {
            loserUser.stats.losses += 1;
            loserUser.stats.gamesPlayed += 1;
            await loserUser.save();

            // Find loser socket to notify balance (ensure sync)
            for (const [sId, data] of activePlayers.entries()) {
                if (data.gameId === gameId && sId !== socket.id) {
                    io.to(sId).emit('balance_updated', loserUser.coins);
                    break;
                }
            }
            }
        }

        // Clear active players
        activePlayers.delete(socket.id); // Winner
        // Remove loser from activePlayers
        for (const [sId, data] of activePlayers.entries()) {
            if (data.gameId === gameId) {
                activePlayers.delete(sId);
            }
        }

        io.to(gameId).emit('game_over', {
          winner,
          winnerId,
          gains: isLive ? 0 : (game.betAmount * 2 * 0.9),
          updatedCoins: !isLive ? {
              [winnerId]: winnerUser.coins,
              [loserId]: loserUser.coins
          } : undefined
        });

      } else {
        // Check for Draw (Full Board)
        const MAX_MOVES = 18 * 28; // 504
        if (game.board.length >= MAX_MOVES) {
            game.status = 'completed';
            game.winner = null; // Draw
            game.winnerId = null;

            if (!isLive) await game.save();
            else liveGames.delete(gameId);

            if (!isLive) {
                // Clear currentGame
                await User.updateMany(
                    { _id: { $in: [game.players.black, game.players.white] } },
                    { $set: { currentGame: null } }
                );

                // Refund Bets
                const p1 = await User.findById(game.players.black);
                const p2 = await User.findById(game.players.white);
                const bet = game.betAmount;

                if (p1) {
                    const oldBal = p1.coins;
                    p1.coins += bet;
                    p1.stats.gamesPlayed += 1;
                    p1.stats.draws += 1;
                    await p1.save();
                    await logTransaction(p1._id, bet, 'REMBOURSEMENT', 'Match nul', oldBal, p1.coins, { gameId });
                    
                    // Find socket
                    for (const [sId, data] of activePlayers.entries()) {
                         if (data.userId === p1._id.toString()) io.to(sId).emit('balance_updated', p1.coins);
                    }
                }
                if (p2) {
                    const oldBal = p2.coins;
                    p2.coins += bet;
                    p2.stats.gamesPlayed += 1;
                    p2.stats.draws += 1;
                    await p2.save();
                    await logTransaction(p2._id, bet, 'REMBOURSEMENT', 'Match nul', oldBal, p2.coins, { gameId });

                    for (const [sId, data] of activePlayers.entries()) {
                         if (data.userId === p2._id.toString()) io.to(sId).emit('balance_updated', p2.coins);
                    }
                }
            }

            // Clear active players
            for (const [sId, data] of activePlayers.entries()) {
                if (data.gameId === gameId) activePlayers.delete(sId);
            }

            io.to(gameId).emit('game_over', {
                winner: null,
                winnerId: null,
                gains: 0,
                reason: 'draw',
                updatedCoins: !isLive ? {
                    [game.players.black]: p1.coins,
                    [game.players.white]: p2.coins
                } : undefined
            });
            return;
        }

        // Next turn
        game.currentTurn = player === 'black' ? 'white' : 'black';
        if (!isLive) {
            game.markModified('timeouts'); // Ensure timeouts update is saved
            await game.save();
        } else {
            // In memory update is already done by reference
        }

        io.to(gameId).emit('move_made', {
          row, col, player,
          nextTurn: game.currentTurn,
          newAutoPlayCount: newAutoPlayCount
        });
      }

    } catch (err) {
      console.error('Error in make_move:', err);
    }
  });

  socket.on('player_ready_next_round', async ({ gameId, userId }) => {
      try {
          const isLive = gameId && typeof gameId === 'string' && gameId.startsWith('live_');
          let game;
          
          if (isLive) {
              game = liveGames.get(gameId);
          } else {
              game = await Game.findById(gameId);
          }

          if (game && game.mode === 'tournament') {
              // Add to ready list if not present
              const uidStr = userId.toString();
              if (!game.readyForNextRound) game.readyForNextRound = [];
              
              const isReady = game.readyForNextRound.some(id => id.toString() === uidStr);
              if (!isReady) {
                  game.readyForNextRound.push(userId);
                  
                  if (!isLive) {
                      game.markModified('readyForNextRound');
                      await game.save();
                  }
              }

              const readyCount = new Set(game.readyForNextRound.map(id => id.toString())).size;
              
              if (readyCount >= 2) {
                  io.to(gameId).emit('start_next_round', {
                       nextGameNumber: game.tournamentSettings.gameNumber,
                       nextTurn: game.currentTurn,
                       score: game.tournamentSettings.score,
                       timeControl: game.timeControl
                  });
              }
          }
      } catch (err) {
          console.error('Error in player_ready_next_round:', err);
      }
  });

  socket.on('resign', async () => {
     const playerData = activePlayers.get(socket.id);
     if (playerData) {
         const { gameId, userId: resigningUserId } = playerData;
         activePlayers.delete(socket.id);
         
         const isLive = gameId && typeof gameId === 'string' && gameId.startsWith('live_');

         try {
             let game;
             if (isLive) {
                 game = liveGames.get(gameId);
             } else {
                 game = await Game.findById(gameId);
             }

             if (game && game.status === 'active') {
                 // Clear currentGame for both players (Only for DB games)
                 if (!isLive) {
                    await User.updateMany(
                        { _id: { $in: [game.players.black, game.players.white] } },
                        { $set: { currentGame: null } }
                    );
                 }

                 let opponentSocketId = null;
                 let opponentUserId = null;
                 
                 for (const [sId, data] of activePlayers.entries()) {
                     if (data.gameId === gameId) {
                         opponentSocketId = sId;
                         opponentUserId = data.userId;
                         break;
                     }
                 }
                 
                 if (opponentUserId) {
                     game.status = 'completed';
                     const winnerColor = game.players.black.toString() === opponentUserId.toString() ? 'black' : 'white';
                     game.winner = winnerColor;
                     game.winnerId = opponentUserId;
                     
                     if (!isLive) {
                        await game.save();
                     } else {
                        // LIVE MODE HANDLER
                        const creatorId = game.createur._id || game.createur.id;
                        const isCreator = resigningUserId.toString() === creatorId.toString();

                        if (isCreator) {
                            liveGames.delete(gameId);
                            if (opponentSocketId) {
                                io.to(opponentSocketId).emit('live_room_closed');
                            }
                        } else {
                            // Opponent resigned -> Keep room open
                            game.players.white = null;
                            game.status = 'waiting';
                            game.board = [];
                            game.currentTurn = 'black';
                            game.winner = null;
                            game.winnerId = null;

                            if (opponentSocketId) {
                                io.to(opponentSocketId).emit('opponent_left_live');
                            }
                            return; // Stop here, don't emit game_over
                        }
                     }
                     
                     if (!isLive) {
                        const bet = game.betAmount;
                        const totalPot = bet * 2;
                        const winnerGain = Math.floor(totalPot * 0.9);
                        
                        const winnerUser = await User.findById(opponentUserId);
                        if (winnerUser) {
                            const oldBalance = winnerUser.coins;
                            winnerUser.coins += winnerGain;
                            winnerUser.stats.wins += 1;
                            winnerUser.stats.gamesPlayed += 1;
                            await winnerUser.save();
                            await logTransaction(winnerUser._id, winnerGain, 'CREDIT', 'Gain victoire (abandon)', oldBalance, winnerUser.coins, { gameId, reason: 'resign' });
                            
                            if (opponentSocketId) {
                                io.to(opponentSocketId).emit('balance_updated', winnerUser.coins);
                            }
                        }
                        
                        const loserUser = await User.findById(resigningUserId);
                        if (loserUser) {
                            loserUser.stats.losses += 1;
                            loserUser.stats.gamesPlayed += 1;
                            await loserUser.save();
                        }
                     }
                     
                     if (opponentSocketId) {
                        if (!isLive) io.to(opponentSocketId).emit('opponent_disconnected'); // Or 'opponent_resigned'
                        io.to(opponentSocketId).emit('game_over', {
                            winner: winnerColor,
                            winnerId: opponentUserId,
                            gains: isLive ? 0 : Math.floor(game.betAmount * 2 * 0.9),
                            reason: 'resign'
                        });
                     }
                     
                     if (opponentSocketId) {
                         activePlayers.delete(opponentSocketId);
                     }
                 }
             }
         } catch (err) {
             console.error('Error handling resign game:', err);
         }
     }
  });

  // --- Chat Messages ---
  socket.on('MESSAGE_TEXTE', (data) => {
      const { matchId } = data;
      // Broadcast to opponent only (sender handles their own display)
      socket.to(matchId).emit('MESSAGE_TEXTE', data);
  });

  socket.on('MESSAGE_EMOJI', (data) => {
      const { matchId } = data;
      socket.to(matchId).emit('MESSAGE_EMOJI', data);
  });

  // --- Voice Chat Signaling ---
  socket.on('voice_join', (data) => {
      const { gameId } = data;
      socket.to(gameId).emit('voice_join', data);
  });

  socket.on('voice_offer', (data) => {
      const { gameId } = data;
      socket.to(gameId).emit('voice_offer', data);
  });

  socket.on('voice_answer', (data) => {
      const { gameId } = data;
      socket.to(gameId).emit('voice_answer', data);
  });

  socket.on('voice_candidate', (data) => {
      const { gameId } = data;
      socket.to(gameId).emit('voice_candidate', data);
  });

  // --- Rematch Logic ---
  socket.on('request_rematch', async ({ gameId }) => {
    try {
      const sockets = await io.in(gameId).fetchSockets();
      // Expecting 2 sockets in the room (requester + opponent)
      if (sockets.length < 2) {
        socket.emit('rematch_failed', 'Adversaire parti');
        return;
      }
      
      // Notify the other player
      socket.to(gameId).emit('rematch_requested', { gameId });
    } catch (err) {
      console.error('Error in request_rematch:', err);
    }
  });

  socket.on('respond_rematch', async ({ gameId, accepted }) => {
    try {
      if (!accepted) {
        socket.to(gameId).emit('rematch_declined');
        return;
      }

      // Check if both players are still present
      const sockets = await io.in(gameId).fetchSockets();
      if (sockets.length < 2) {
        socket.emit('rematch_failed', 'Adversaire parti');
        return;
      }

      // Identify players
      // We attached socket.data.userId in find_game
      // Or we can rely on the old game record
      const oldGame = await Game.findById(gameId);
      if (!oldGame) {
        io.to(gameId).emit('rematch_failed', 'Jeu introuvable');
        return;
      }

      const player1Socket = sockets[0];
      const player2Socket = sockets[1];

      // Verify users using socket.data (robust against activePlayers cleanup)
      let user1Id = player1Socket.data.userId;
      let user2Id = player2Socket.data.userId;

      if (!user1Id || !user2Id) {
         console.log('Missing userId on sockets for rematch', { user1Id, user2Id });
         // Fallback: Try to use activePlayers if data.userId is missing (legacy support)
         const apUser1 = activePlayers.get(player1Socket.id)?.userId;
         const apUser2 = activePlayers.get(player2Socket.id)?.userId;
         
         if (!user1Id && apUser1) {
             // player1Socket.data.userId = apUser1; // Can't set remote socket data easily here without update
         }
         
         if ((!user1Id && !apUser1) || (!user2Id && !apUser2)) {
             io.to(gameId).emit('rematch_failed', 'Erreur identification joueurs');
             return;
         }
         
         // Use the found IDs
         // We'll proceed with user1Id/user2Id variables, so let's assign them if fallback found
         if (!user1Id) user1Id = apUser1;
         if (!user2Id) user2Id = apUser2;
      }

      const betAmount = oldGame.betAmount;
      const timeControl = oldGame.timeControl;

      // Check balances
      const user1 = await User.findById(user1Id);
      const user2 = await User.findById(user2Id);

      if (!user1 || !user2) {
        io.to(gameId).emit('rematch_failed', 'Utilisateur introuvable');
        return;
      }

      if (user1.coins < betAmount || user2.coins < betAmount) {
        io.to(gameId).emit('rematch_failed', 'Fonds insuffisants pour l\'un des joueurs');
        return;
      }

      // Deduct coins
      user1.coins -= betAmount;
      user2.coins -= betAmount;
      await user1.save();
      await user2.save();

      // Notify balance updates
      player1Socket.emit('balance_updated', user1.coins);
      player2Socket.emit('balance_updated', user2.coins);

      // Create New Game
      // Swap colors? Or Random? Let's swap for fairness if possible, or just keep simple.
      // oldGame.players.black / white.
      // Let's swap: black -> white, white -> black.
      // We need to map socketId to black/white.
      // Actually, just swapping the IDs in the new game creation is enough.
      
      const newGameData = {
          players: {
            black: oldGame.players.white, // Swap
            white: oldGame.players.black
          },
          betAmount: betAmount,
          timeControl: timeControl,
          currentTurn: 'black',
          status: 'active',
          mode: oldGame.mode || 'simple'
      };

      if (oldGame.mode === 'tournament' && oldGame.tournamentSettings) {
          newGameData.tournamentSettings = {
              totalGames: oldGame.tournamentSettings.totalGames,
              gameNumber: 1,
              score: { black: 0, white: 0 }
          };
      }

      const newGame = await Game.create(newGameData);

      const newGameId = newGame._id.toString();

      // Make sockets join the NEW room
      player1Socket.join(newGameId);
      player2Socket.join(newGameId);
      
      // Update activePlayers map
      activePlayers.set(player1Socket.id, { gameId: newGameId, userId: user1Id });
      activePlayers.set(player2Socket.id, { gameId: newGameId, userId: user2Id });

      // Emit game_start to the OLD room (or individual sockets) with NEW game data
      // IMPORTANT: We send 'game_start' with the NEW gameId.
      // The clients will navigate to the new game, effectively leaving the old screen context.
      
      // Correctly map the player objects
      const blackUser = newGame.players.black.toString() === user1._id.toString() ? user1 : user2;
      const whiteUser = newGame.players.white.toString() === user1._id.toString() ? user1 : user2;

      const payload = {
          gameId: newGameId,
          players: {
            black: { 
              id: blackUser._id.toString(),
              pseudo: blackUser.pseudo,
              avatar: blackUser.avatar,
              country: blackUser.country,
              coins: blackUser.coins
            },
            white: { 
              id: whiteUser._id.toString(),
              pseudo: whiteUser.pseudo,
              avatar: whiteUser.avatar,
              country: whiteUser.country,
              coins: whiteUser.coins
            }
          },
          currentTurn: 'black',
          betAmount,
          timeControl,
          tournamentSettings: newGame.mode === 'tournament' ? newGame.tournamentSettings : undefined
      };

      io.to(newGameId).emit('game_start', payload);
      
      console.log(`Rematch started: ${newGameId} (swapped colors)`);

    } catch (err) {
      console.error('Error in respond_rematch:', err);
      socket.emit('error', 'Erreur lors du rematch');
    }
  });

  socket.on('stop_live_room', ({ gameId }) => {
      if (liveGames.has(gameId)) {
          const game = liveGames.get(gameId);
          liveGames.delete(gameId);
          io.to(gameId).emit('live_room_closed');
          console.log(`Live room ${gameId} stopped manually`);
      }
  });

  socket.on('disconnect', async () => {
     // 1. Check if user is in an active game
     const playerData = activePlayers.get(socket.id);
     if (playerData) {
         const { gameId, userId: disconnectedUserId } = playerData;
         activePlayers.delete(socket.id);
         
         const isLive = gameId && typeof gameId === 'string' && gameId.startsWith('live_');

         try {
             let game;
             if (isLive) {
                 game = liveGames.get(gameId);
             } else {
                 game = await Game.findById(gameId);
             }

             if (game && game.status === 'active') {
                 // Determine winner (the remaining player)
                 let opponentSocketId = null;
                 let opponentUserId = null;
                 
                 for (const [sId, data] of activePlayers.entries()) {
                     if (data.gameId === gameId) {
                         opponentSocketId = sId;
                         opponentUserId = data.userId;
                         break;
                     }
                 }
                 
                 if (opponentUserId) {
                     // The disconnected user loses, opponent wins
                     game.status = 'completed';
                     
                     // If opponent is black in game, winner is black.
                     // But we have opponentUserId.
                     const winnerColor = game.players.black.toString() === opponentUserId.toString() ? 'black' : 'white';
                     game.winner = winnerColor;
                     game.winnerId = opponentUserId;
                     
                     if (!isLive) {
                        await game.save();
                     } else {
                         // LIVE MODE HANDLER
                         const creatorId = game.createur._id || game.createur.id;
                         const isCreator = disconnectedUserId.toString() === creatorId.toString();
                         
                         if (isCreator) {
                             // Creator left -> Close room
                             liveGames.delete(gameId);
                             if (opponentSocketId) {
                                 io.to(opponentSocketId).emit('live_room_closed');
                             }
                         } else {
                             // Opponent left -> Keep room open
                             game.players.white = null;
                             game.status = 'waiting';
                             game.board = [];
                             game.currentTurn = 'black';
                             game.winner = null; // Reset winner
                             game.winnerId = null;

                             if (opponentSocketId) {
                                 io.to(opponentSocketId).emit('opponent_left_live');
                             }
                             // Stop processing here for Live Opponent (don't emit standard game_over)
                             return; 
                         }
                     }
                     
                     if (!isLive) {
                        // Handle Rewards for Winner
                        const bet = game.betAmount;
                        const totalPot = bet * 2;
                        const winnerGain = Math.floor(totalPot * 0.9);
                        
                        const winnerUser = await User.findById(opponentUserId);
                        if (winnerUser) {
                            const oldBalance = winnerUser.coins;
                            winnerUser.coins += winnerGain;
                            winnerUser.stats.wins += 1;
                            winnerUser.stats.gamesPlayed += 1;
                            await winnerUser.save();
                            await logTransaction(winnerUser._id, winnerGain, 'GAIN', 'Victoire par déconnexion', oldBalance, winnerUser.coins, { gameId });
                            
                            if (opponentSocketId) {
                                io.to(opponentSocketId).emit('balance_updated', winnerUser.coins);
                            }
                        }
                        
                        // Handle Loser (Disconnected)
                        const loserUser = await User.findById(disconnectedUserId);
                        if (loserUser) {
                            loserUser.stats.losses += 1;
                            loserUser.stats.gamesPlayed += 1;
                            await loserUser.save();
                        }
                     }
                     
                     if (opponentSocketId) {
                        io.to(opponentSocketId).emit('opponent_disconnected');
                        io.to(opponentSocketId).emit('game_over', {
                            winner: winnerColor,
                            winnerId: opponentUserId,
                            gains: isLive ? 0 : Math.floor(game.betAmount * 2 * 0.9)
                        });
                     }
                     
                     // Cleanup opponent from activePlayers
                     if (opponentSocketId) {
                         activePlayers.delete(opponentSocketId);
                     }
                 }
             }
         } catch (err) {
             console.error('Error handling disconnect game:', err);
         }
     }

     // 2. Remove from queues if disconnected
     for (const bet in queues) {
      const index = queues[bet].findIndex(p => p.socketId === socket.id);
      if (index !== -1) {
        const p = queues[bet][index];
        queues[bet].splice(index, 1);
        // Refund logic needed here too strictly speaking, but complex without userId in context easily
        // Assuming client handles explicit cancel, or reconnect logic. 
        // For MVP, we might skip auto-refund on disconnect to prevent abuse, 
        // or we need to fetch User and refund.
        
        // Attempt refund
        User.findById(p.userId).then(async user => {
            if(user) {
                const refundAmount = parseInt(bet);
                const oldBalance = user.coins;
                user.coins += refundAmount;
                await user.save();
                await logTransaction(user._id, refundAmount, 'REMBOURSEMENT', 'Déconnexion recherche', oldBalance, user.coins, { queueKey: bet });
                console.log(`Refunded ${refundAmount} to ${user.pseudo} on disconnect`);
            }
        }).catch(err => console.error(err));
      }
    }
  });
};
