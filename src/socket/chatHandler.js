const Message = require('../models/Message');

module.exports = (io, socket) => {
  // Handle typing status
  socket.on('typing', ({ recipientId, isTyping }) => {
    io.to(recipientId).emit('friend_typing', { 
      friendId: socket.userId, // Assuming socket.userId is set during auth/handshake or we pass it
      isTyping 
    });
  });

  // Handle message delivered
  socket.on('message_delivered', async ({ messageId, senderId }) => {
      try {
          await Message.findByIdAndUpdate(messageId, { status: 'delivered' });
          io.to(senderId).emit('message_delivered_receipt', { messageId });
      } catch (e) {
          console.error("Error updating delivered status", e);
      }
  });

  // Handle message read
  socket.on('message_read', ({ messageId, senderId }) => {
    // This is redundant if we use the REST API for marking read, 
    // but useful for granular updates if we switch to pure socket later.
    // For now, we use the controller's 'messages_read' event.
    io.to(senderId).emit('message_read_receipt', { messageId });
  });

  // --- CALL SIGNALING ---
  
  // Call User
  socket.on('call_user', (data) => {
    // data: { userToCall, signalData, from, name, avatar, type }
    io.to(data.userToCall).emit('incoming_call', { 
      signal: data.signalData, 
      from: data.from, 
      name: data.name,
      avatar: data.avatar,
      type: data.type
    });
  });

  // Answer Call
  socket.on('answer_call', (data) => {
    // data: { to, signal }
    io.to(data.to).emit('call_accepted', data.signal);
  });

  // End Call
  socket.on('end_call', (data) => {
    // data: { to }
    io.to(data.to).emit('call_ended');
  });

  // ICE Candidate (for WebRTC future proofing)
  socket.on('ice_candidate', (data) => {
      io.to(data.to).emit('ice_candidate', data.candidate);
  });
};
