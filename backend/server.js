// backend/server.js
// Main backend entry: Express + MongoDB + Socket.IO + routes.

require('dotenv').config(); // MUST be first

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

// Cloudinary config (event poster uploads)
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Routes
const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/event');
const schoolRoutes = require('./routes/School');
const adminRoutes = require('./routes/admin');
const chatRoutes = require('./routes/chat');
const notificationRoutes = require('./routes/notifications');
const activityRoutes = require('./routes/activity');
const publicRoutes = require('./routes/public');
const journalRoutes = require('./routes/journal');

// Socket handlers
const initializeGroupChat = require('./socket/groupChatHandler');

const app = express();

// Authenticated APIs should not be cached by browsers (prevents 304 stale data).
app.disable('etag');
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use(
  cors({
    origin: '*', // Change to your frontend URL in production
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/school', schoolRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/journal', journalRoutes);

app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Rwandan Youth Worship Backend',
    status: 'alive',
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Initialize authenticated group chat over sockets.
initializeGroupChat(io);

mongoose
  .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45000 })
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => {
    console.error('MongoDB connection FAILED:', err.message);
    process.exit(1);
  });

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

process.on('unhandledRejection', (err) => {
  console.log('UNHANDLED PROMISE REJECTION!');
  console.error(err);
  server.close(() => process.exit(1));
});

module.exports = { app, server, io };
