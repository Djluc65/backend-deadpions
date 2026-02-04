const User = require('../models/User');
const FriendRequest = require('../models/FriendRequest');

// Send a friend request
exports.sendRequest = async (req, res) => {
  try {
    const { recipientId } = req.body;
    const senderId = req.user.userId;

    if (!recipientId) {
      return res.status(400).json({ message: "ID destinataire manquant." });
    }

    if (senderId === recipientId) {
      return res.status(400).json({ message: "Vous ne pouvez pas vous ajouter vous-même en ami." });
    }

    const recipient = await User.findById(recipientId);
    if (!recipient) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    // Check if already friends
    const sender = await User.findById(senderId);
    if (!sender) {
      return res.status(404).json({ message: "Expéditeur non trouvé." });
    }

    // Safe check using some() and toString() for ObjectId comparison
    const isFriend = sender.friends && sender.friends.some(id => id.toString() === recipientId);
    if (isFriend) {
      return res.status(400).json({ message: "Vous êtes déjà amis." });
    }

    // Check if request already exists
    const existingRequest = await FriendRequest.findOne({
      sender: senderId,
      recipient: recipientId,
      status: 'pending'
    });

    if (existingRequest) {
      return res.status(400).json({ message: "Demande déjà envoyée." });
    }
    
    // Check if recipient already sent a request
    const reverseRequest = await FriendRequest.findOne({
      sender: recipientId,
      recipient: senderId,
      status: 'pending'
    });
    
    if (reverseRequest) {
       return res.status(400).json({ message: "Cet utilisateur vous a déjà envoyé une demande. Vérifiez vos réceptions." });
    }

    const request = new FriendRequest({
      sender: senderId,
      recipient: recipientId
    });

    await request.save();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(recipientId).emit('friend_request_received', {
        senderId: senderId,
        senderName: sender.pseudo
      });
    }

    res.status(201).json({ message: "Demande envoyée.", request });
  } catch (error) {
    console.error("SendRequest Error:", error);
    if (error.code === 11000) {
      return res.status(400).json({ message: "Demande déjà existante." });
    }
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

// Get all requests (sent and received)
exports.getRequests = async (req, res) => {
  try {
    const userId = req.user.userId;

    const received = await FriendRequest.find({ recipient: userId, status: 'pending' })
      .populate('sender', 'pseudo avatar country');
      
    const sent = await FriendRequest.find({ sender: userId, status: 'pending' })
      .populate('recipient', 'pseudo avatar country');

    res.json({ received, sent });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

// Accept friend request
exports.acceptRequest = async (req, res) => {
  try {
    const { requestId } = req.body;
    const userId = req.user.userId;

    const request = await FriendRequest.findOne({ _id: requestId, recipient: userId, status: 'pending' });
    if (!request) {
      return res.status(404).json({ message: "Demande non trouvée ou déjà traitée." });
    }

    request.status = 'accepted';
    await request.save();

    // Add to friends list for both users
    await User.findByIdAndUpdate(request.sender, { $addToSet: { friends: request.recipient } });
    await User.findByIdAndUpdate(request.recipient, { $addToSet: { friends: request.sender } });

    res.json({ message: "Demande acceptée.", request });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

// Decline friend request
exports.declineRequest = async (req, res) => {
  try {
    const { requestId } = req.body;
    const userId = req.user.userId;

    const request = await FriendRequest.findOne({ _id: requestId, recipient: userId, status: 'pending' });
    if (!request) {
      return res.status(404).json({ message: "Demande non trouvée." });
    }

    request.status = 'rejected';
    await request.save();
    // Or await FriendRequest.findByIdAndDelete(requestId);

    res.json({ message: "Demande refusée." });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

// Remove friend
exports.removeFriend = async (req, res) => {
  try {
    const { friendId } = req.params;
    const userId = req.user.userId;

    await User.findByIdAndUpdate(userId, { $pull: { friends: friendId } });
    await User.findByIdAndUpdate(friendId, { $pull: { friends: userId } });

    // Also remove any existing requests to be clean
    await FriendRequest.deleteMany({
      $or: [
        { sender: userId, recipient: friendId },
        { sender: friendId, recipient: userId }
      ]
    });

    res.json({ message: "Ami supprimé." });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

// Get friends list
exports.getFriends = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId).populate('friends', 'pseudo avatar country isOnline lastSeen currentGame');
    
    res.json(user.friends);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

// Search users
exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);

    const users = await User.find({
      pseudo: { $regex: q, $options: 'i' },
      _id: { $ne: req.user.userId } // Exclude self
    }).select('pseudo avatar country');

    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

exports.cancelLatestRequest = async (req, res) => {
  try {
    const userId = req.user.userId;
    const latest = await FriendRequest.findOne({ sender: userId, status: 'pending' }).sort({ createdAt: -1 });
    if (!latest) {
      return res.status(404).json({ message: "Aucune demande à annuler." });
    }
    await FriendRequest.findByIdAndDelete(latest._id);
    res.json({ message: "Dernière demande annulée." });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};
