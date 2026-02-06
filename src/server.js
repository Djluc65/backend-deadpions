require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const User = require('./models/User');
const rateLimiter = require('./middleware/rateLimiter');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const friendRoutes = require('./routes/friend.routes');
const chatRoutes = require('./routes/chat.routes');
const paymentRoutes = require('./routes/payment.routes');

const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Make io accessible in routes
app.set('io', io);

// Middleware
app.use(cors());
app.use(express.json());
// Appliquer rate limiter global
app.use(rateLimiter.globalLimiter);

app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/payment', paymentRoutes);

app.get('/', (req, res) => {
  res.send('DeadPions API is running');
});

const gameHandler = require('./socket/gameHandler');
const chatHandler = require('./socket/chatHandler'); // Need to create this

// Socket.io
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Join user to their own room for private messages
  socket.on('join_user_room', async (userId) => {
      socket.join(userId);
      socket.userId = userId; // Store userId on socket for disconnect handler
      socket.data.userId = userId; // Store in data for fetchSockets() access
      console.log(`Socket ${socket.id} joined user room ${userId}`);
      
      // Update status to online
      try {
        await User.findByIdAndUpdate(userId, { isOnline: true });
        
        // Notify friends
        const user = await User.findById(userId);
        if (user && user.friends) {
             user.friends.forEach(friendId => {
                 io.to(friendId.toString()).emit('friend_status_updated', { userId: userId, isOnline: true });
             });
        }
      } catch (err) {
        console.error("Error updating online status:", err);
      }
  });

  // Attach handlers
  gameHandler(io, socket);
  if (chatHandler) chatHandler(io, socket);

  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);

    if (socket.userId) {
       try {
         await User.findByIdAndUpdate(socket.userId, { 
           isOnline: false, 
           lastSeen: new Date() 
         });
         
         const user = await User.findById(socket.userId);
         if (user && user.friends) {
             user.friends.forEach(friendId => {
                 io.to(friendId.toString()).emit('friend_status_updated', { userId: socket.userId, isOnline: false });
             });
         }
       } catch (err) {
         console.error("Error updating offline status:", err);
       }
     }
  });
});

// Database Connection
const PORT = process.env.PORT || 5001;
const MONGODB_URI = process.env.URL_DB || process.env.MONGODB_URI; // Updated to use URL_DB as per user's .env

if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));
} else {
  console.log('MONGODB_URI/URL_DB not found in .env, skipping database connection');
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
