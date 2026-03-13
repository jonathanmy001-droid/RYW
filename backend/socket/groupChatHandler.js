const jwt = require('jsonwebtoken');

const ChatGroup = require('../models/chatGroup');
const ChatMembership = require('../models/chatMembership');
const ChatMessage = require('../models/chatMessage');
const ActivityEvent = require('../models/activityEvent');
const User = require('../models/user');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-2026';

function extractToken(socket) {
  // Preferred: socket.io client passes { auth: { token } }
  if (socket.handshake && socket.handshake.auth && socket.handshake.auth.token) {
    return String(socket.handshake.auth.token);
  }
  // Fallback: query ?token=...
  if (socket.handshake && socket.handshake.query && socket.handshake.query.token) {
    return String(socket.handshake.query.token);
  }
  return null;
}

async function recordActivity(user, type, meta = {}) {
  try {
    await ActivityEvent.create({
      user: user._id,
      school: user.school || null,
      type,
      meta,
    });
  } catch {
    // ignore
  }
}

function initializeGroupChat(io) {
  // Authenticate sockets
  io.use(async (socket, next) => {
    try {
      const token = extractToken(socket);
      if (!token) return next(new Error('Missing token'));

      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user) return next(new Error('User not found'));
      if (user.isLocked) return next(new Error('Account locked'));
      if (user.role !== 'super_admin' && !user.school) return next(new Error('Missing school assignment'));

      socket.user = user;
      return next();
    } catch (err) {
      return next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;

    function emitLiveCount() {
      const room = io.sockets.adapter.rooms.get('live:worship');
      const count = room ? room.size : 0;
      io.to('live:worship').emit('live:count', { count });
    }

    socket.on('live:join', async () => {
      try {
        socket.join('live:worship');
        emitLiveCount();
        socket.emit('live:joined', { ok: true });
      } catch {
        // ignore
      }
    });

    socket.on('live:leave', () => {
      socket.leave('live:worship');
      emitLiveCount();
    });

    socket.on('group:join', async ({ groupId }) => {
      try {
        if (!groupId) return;
        const group = await ChatGroup.findById(groupId).lean();
        if (!group || !group.isActive) return;

        if (user.role !== 'super_admin') {
          if (group.visibility !== 'national' && String(group.school) !== String(user.school)) return;
        }

        const membership = await ChatMembership.findOne({ group: group._id, user: user._id }).lean();
        if (!membership || membership.status === 'pending' || membership.status === 'banned') return;

        socket.join(`group:${group._id}`);
        socket.emit('group:joined', { groupId: String(group._id) });
      } catch {
        // ignore
      }
    });

    socket.on('group:leave', async ({ groupId }) => {
      if (!groupId) return;
      socket.leave(`group:${groupId}`);
      socket.emit('group:left', { groupId: String(groupId) });
    });

    socket.on('group:message', async ({ groupId, text }) => {
      try {
        if (!groupId || !text || !String(text).trim()) return;

        const group = await ChatGroup.findById(groupId);
        if (!group || !group.isActive) return;

        if (user.role !== 'super_admin') {
          if (group.visibility !== 'national' && String(group.school) !== String(user.school)) return;
        }

        const membership = await ChatMembership.findOne({ group: group._id, user: user._id }).lean();
        if (!membership || membership.status === 'pending' || membership.status === 'banned') return;

        if (membership.status === 'muted' && membership.mutedUntil) {
          if (new Date(membership.mutedUntil) > new Date()) return;
        }

        const msg = await ChatMessage.create({
          group: group._id,
          sender: user._id,
          text: String(text).trim(),
        });

        group.lastMessageAt = new Date();
        await group.save();

        await recordActivity(user, 'send_message', { groupId: String(group._id), via: 'socket' });

        const hydrated = await ChatMessage.findById(msg._id)
          .populate('sender', 'firstName lastName email role')
          .lean();

        io.to(`group:${group._id}`).emit('group:message', hydrated);
      } catch {
        // ignore
      }
    });

    socket.on('disconnect', () => {
      emitLiveCount();
    });
  });
}

module.exports = initializeGroupChat;
