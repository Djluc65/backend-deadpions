const Message = require('../models/Message');
const User = require('../models/User');

// Send message
exports.sendMessage = async (req, res) => {
  try {
    const { recipientId, content, type, audioUri } = req.body;
    const senderId = req.user.userId;

    const message = new Message({
      sender: senderId,
      recipient: recipientId,
      content,
      type: type || 'text',
      audioUri,
      status: 'sent'
    });

    await message.save();

    if (req.app.get('io')) {
        const io = req.app.get('io');
        io.to(recipientId).emit('receive_message', message);
    }

    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

exports.uploadAudio = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Aucun fichier audio fourni." });
    }
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url: fileUrl });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de l'upload audio", error: error.message });
  }
};

// Get messages with a specific user
exports.getMessages = async (req, res) => {
  try {
    const { friendId } = req.params;
    const userId = req.user.userId;

    const messages = await Message.find({
      $or: [
        { sender: userId, recipient: friendId },
        { sender: friendId, recipient: userId }
      ]
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

// Get all conversations (last message for each)
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Aggregation to find last message per contact
    // 1. Find all messages involving the user
    // 2. Sort by date desc
    // 3. Group by the "other" person
    
    // Note: This can be heavy on large datasets. 
    // Optimization: Add 'lastMessage' field to a 'Conversation' model if scaling.
    
    // Since we use strings/ObjectIds, we need to handle types correctly.
    const mongoose = require('mongoose');
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const conversations = await Message.aggregate([
      {
        $match: {
          $or: [{ sender: userObjectId }, { recipient: userObjectId }]
        }
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ["$sender", userObjectId] },
              "$recipient",
              "$sender"
            ]
          },
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [
                    { $eq: ["$recipient", userObjectId] },
                    { $eq: ["$read", false] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'friend'
        }
      },
      {
        $unwind: '$friend'
      },
      {
        $project: {
          friendId: '$_id',
          name: '$friend.pseudo',
          avatar: '$friend.avatar',
          lastMessage: '$lastMessage.content',
          timestamp: '$lastMessage.createdAt',
          unread: '$unreadCount',
          lastRead: '$lastMessage.read' // Simplified
        }
      }
    ]);

    res.json(conversations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

// Mark messages as read
exports.markAsRead = async (req, res) => {
  try {
    const { friendId } = req.body;
    const userId = req.user.userId;

    // Update both 'read' boolean and 'status' enum
    await Message.updateMany(
      { sender: friendId, recipient: userId, read: false },
      { $set: { read: true, status: 'read' } }
    );

    // Notify the sender (friendId) that their messages have been read by userId
    if (req.app.get('io')) {
        const io = req.app.get('io');
        io.to(friendId).emit('messages_read', { 
            readerId: userId,
            friendId: friendId // sender
        });
    }

    res.json({ message: "Messages marqués comme lus." });
  } catch (error) {
    res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};
