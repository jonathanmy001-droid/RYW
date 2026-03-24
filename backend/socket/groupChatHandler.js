const jwt = require('jsonwebtoken');

const ChatGroup = require('../models/chatGroup');
const ChatMembership = require('../models/chatMembership');
const ChatMessage = require('../models/chatMessage');
const ActivityEvent = require('../models/activityEvent');
const User = require('../models/user');
const Reaction = require('../models/reaction');
const LiveWorshipMessage = require('../models/liveWorshipMessage');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-2026';

// In-memory live stream registry (single broadcaster per sessionKey).
// Note: This is fine for single-node dev/prototype. For production, move to Redis/shared store.
const liveStreams = new Map(); // sessionKey -> { broadcasterSocketId, broadcasterUserId, startedAt }

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

    function emitLiveCount(roomName) {
      const room = io.sockets.adapter.rooms.get(roomName);
      const count = room ? room.size : 0;
      io.to(roomName).emit('live:count', { count, room: roomName });
    }

    function streamRoom(sessionKey) {
      const key = String(sessionKey || '').trim() || 'worship';
      return { key, roomName: `live:worship:${key}` };
    }

    async function emitLiveReactions(sessionKey, roomName) {
      try {
        const rows = await Reaction.aggregate([
          { $match: { targetType: 'worship_session', targetKey: String(sessionKey) } },
          { $group: { _id: '$kind', count: { $sum: 1 } } },
        ]);
        const out = { amen: 0, glory: 0 };
        for (const r of rows) out[String(r._id)] = Number(r.count || 0);
        io.to(roomName).emit('live:reactions', { sessionKey: String(sessionKey), counts: out });
      } catch {
        // ignore
      }
    }

    socket.on('live:join', async ({ sessionKey } = {}) => {
      try {
        const { key, roomName } = streamRoom(sessionKey);
        socket.join(roomName);
        emitLiveCount(roomName);

        // Send latest messages (last 30)
        const msgs = await LiveWorshipMessage.find({ sessionKey: key })
          .sort({ createdAt: -1 })
          .limit(30)
          .populate('user', 'firstName lastName role')
          .lean();
        socket.emit('live:messages:init', { sessionKey: key, items: msgs.reverse() });

        await emitLiveReactions(key, roomName);
        emitStreamStatus(key);
        socket.emit('live:joined', { ok: true, sessionKey: key, room: roomName });
      } catch {
        // ignore
      }
    });

    socket.on('live:leave', async ({ sessionKey } = {}) => {
      const { roomName } = streamRoom(sessionKey);
      socket.leave(roomName);
      emitLiveCount(roomName);
    });

    socket.on('live:message', async ({ sessionKey, text }) => {
      try {
        const key = String(sessionKey || '').trim() || 'worship';
        const roomName = `live:worship:${key}`;
        const body = String(text || '').trim().slice(0, 800);
        if (!body) return;

        const msg = await LiveWorshipMessage.create({
          sessionKey: key,
          user: user._id,
          school: user.school || null,
          text: body,
        });

        await recordActivity(user, 'live_worship_message', { sessionKey: key });

        const hydrated = await LiveWorshipMessage.findById(msg._id)
          .populate('user', 'firstName lastName role')
          .lean();

        io.to(roomName).emit('live:message', hydrated);
      } catch {
        // ignore
      }
    });

    socket.on('live:reaction', async ({ sessionKey, kind }) => {
      try {
        const { key, roomName } = streamRoom(sessionKey);
        const k = String(kind || '').trim().toLowerCase();
        if (!['amen', 'glory'].includes(k)) return;

        const query = { user: user._id, targetType: 'worship_session', targetKey: key, kind: k };
        const existing = await Reaction.findOne(query).select('_id');
        if (existing) {
          await Reaction.deleteOne({ _id: existing._id });
        } else {
          await Reaction.create(query);
        }

        await recordActivity(user, 'live_worship_react', { sessionKey: key, kind: k });
        await emitLiveReactions(key, roomName);
      } catch {
        // ignore
      }
    });

    function emitStreamStatus(sessionKey) {
      const { key, roomName } = streamRoom(sessionKey);
      const stream = liveStreams.get(key) || null;
      const room = io.sockets.adapter.rooms.get(roomName);
      const count = room ? room.size : 0;
      io.to(roomName).emit('stream:status', {
        sessionKey: key,
        isLive: Boolean(stream),
        startedAt: stream ? stream.startedAt : null,
        broadcasterUserId: stream ? String(stream.broadcasterUserId) : null,
        viewers: count,
      });
    }

    socket.on('stream:go_live', async ({ sessionKey } = {}) => {
      try {
        const { key, roomName } = streamRoom(sessionKey);

        // Only pastors (and super_admin) can broadcast.
        if (!['pastor', 'super_admin'].includes(String(user.role || '').toLowerCase())) return;

        liveStreams.set(key, { broadcasterSocketId: socket.id, broadcasterUserId: user._id, startedAt: new Date() });
        socket.join(roomName);
        emitLiveCount(roomName);
        emitStreamStatus(key);

        await recordActivity(user, 'live_stream_started', { sessionKey: key });
      } catch {
        // ignore
      }
    });

    socket.on('stream:end', async ({ sessionKey } = {}) => {
      try {
        const { key, roomName } = streamRoom(sessionKey);
        const stream = liveStreams.get(key);
        if (!stream) return;
        if (String(stream.broadcasterSocketId) !== String(socket.id)) return;
        liveStreams.delete(key);
        io.to(roomName).emit('stream:ended', { sessionKey: key });
        emitStreamStatus(key);
        await recordActivity(user, 'live_stream_ended', { sessionKey: key });
      } catch {
        // ignore
      }
    });

    // Watch requests: server tells broadcaster to create a WebRTC offer for this watcher.
    socket.on('stream:watch', async ({ sessionKey } = {}) => {
      try {
        const { key, roomName } = streamRoom(sessionKey);
        socket.join(roomName);
        emitLiveCount(roomName);

        const stream = liveStreams.get(key);
        emitStreamStatus(key);
        if (!stream) return;

        // Notify broadcaster that a viewer wants to connect.
        io.to(String(stream.broadcasterSocketId)).emit('stream:watcher', {
          sessionKey: key,
          watcherSocketId: socket.id,
          watcher: { userId: String(user._id), firstName: user.firstName, lastName: user.lastName, role: user.role },
        });
      } catch {
        // ignore
      }
    });

    // WebRTC signaling relay: offer/answer/ice between broadcaster and watcher.
    socket.on('stream:signal', async ({ to, sessionKey, type, data } = {}) => {
      try {
        const target = String(to || '').trim();
        const t = String(type || '').trim();
        const { key } = streamRoom(sessionKey);
        if (!target || !t) return;

        // Gate: only allow signaling when a stream exists.
        const stream = liveStreams.get(key);
        if (!stream) return;

        io.to(target).emit('stream:signal', { from: socket.id, sessionKey: key, type: t, data: data || null });
      } catch {
        // ignore
      }
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
      // If broadcaster disconnected, end stream for that session.
      for (const [key, s] of liveStreams.entries()) {
        if (String(s.broadcasterSocketId) === String(socket.id)) {
          liveStreams.delete(key);
          emitStreamStatus(key);
        }
      }
    });
  });
}

module.exports = initializeGroupChat;
