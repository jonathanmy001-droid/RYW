const express = require('express');
const router = express.Router();

const { protect, requireRoles } = require('../middleware/authMiddleware');

const User = require('../models/user');
const MentorshipRequest = require('../models/mentorshipRequest');
const MentorshipSession = require('../models/mentorshipSession');
const Notification = require('../models/notification');
const ActivityEvent = require('../models/activityEvent');

function safeText(x, max) {
  return String(x || '').trim().slice(0, max);
}

function assertSameSchool(req, otherUser) {
  if (req.user.role === 'super_admin') return;
  if (!req.user.school) {
    const err = new Error('Account missing school');
    err.statusCode = 400;
    throw err;
  }
  if (!otherUser.school || String(otherUser.school) !== String(req.user.school)) {
    const err = new Error('Access denied - different school');
    err.statusCode = 403;
    throw err;
  }
}

// GET /api/mentorship/pastors (youth)
router.get('/pastors', protect, requireRoles('youth'), async (req, res) => {
  try {
    const items = await User.find({ role: 'pastor', school: req.user.school, isApproved: true, isLocked: false })
      .select('firstName lastName email')
      .sort({ firstName: 1 })
      .lean();
    res.json({ success: true, data: items });
  } catch (err) {
    console.error('Mentorship pastors error:', err);
    res.status(500).json({ success: false, message: 'Failed to load pastors.' });
  }
});

// POST /api/mentorship/requests (youth)
// Body: { pastorId?, message }
router.post('/requests', protect, requireRoles('youth'), async (req, res) => {
  try {
    const pastorId = req.body && req.body.pastorId ? String(req.body.pastorId) : '';
    const message = safeText(req.body && req.body.message, 1500);

    let pastor = null;
    if (pastorId) {
      pastor = await User.findById(pastorId).select('role school isApproved isLocked').lean();
      if (!pastor) return res.status(404).json({ success: false, message: 'Pastor not found.' });
      if (pastor.role !== 'pastor') return res.status(400).json({ success: false, message: 'Target must be a pastor.' });
      if (!pastor.isApproved || pastor.isLocked) return res.status(400).json({ success: false, message: 'Pastor is not available.' });
      if (String(pastor.school) !== String(req.user.school)) {
        return res.status(400).json({ success: false, message: 'Pastor must be in your school.' });
      }
    }

    const r = await MentorshipRequest.create({
      school: req.user.school,
      youth: req.user._id,
      pastor: pastorId ? pastorId : null,
      message,
      status: 'pending',
    });

    ActivityEvent.create({
      user: req.user._id,
      school: req.user.school || null,
      type: 'mentorship_request_created',
      meta: { requestId: String(r._id) },
    }).catch(() => {});

    // Notify pastors: targeted pastor if provided, else all pastors in school.
    let pastorIds = [];
    if (pastorId) {
      pastorIds = [pastorId];
    } else {
      const pastors = await User.find({ role: 'pastor', school: req.user.school, isApproved: true, isLocked: false })
        .select('_id')
        .lean();
      pastorIds = pastors.map((p) => String(p._id));
    }
    if (pastorIds.length) {
      Notification.insertMany(
        pastorIds.map((id) => ({
          user: id,
          type: 'mentorship_request',
          title: 'Mentorship Request',
          body: 'A youth requested mentorship.',
          payload: { requestId: String(r._id) },
        }))
      ).catch(() => {});
    }

    res.json({ success: true, data: r });
  } catch (err) {
    console.error('Create mentorship request error:', err);
    res.status(500).json({ success: false, message: 'Failed to create request.' });
  }
});

// GET /api/mentorship/requests/mine (youth)
router.get('/requests/mine', protect, requireRoles('youth'), async (req, res) => {
  try {
    const items = await MentorshipRequest.find({ youth: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('pastor', 'firstName lastName role')
      .lean();
    res.json({ success: true, data: items });
  } catch (err) {
    console.error('My mentorship requests error:', err);
    res.status(500).json({ success: false, message: 'Failed to load requests.' });
  }
});

// POST /api/mentorship/requests/:id/cancel (youth)
router.post('/requests/:id/cancel', protect, requireRoles('youth'), async (req, res) => {
  try {
    const r = await MentorshipRequest.findById(req.params.id).select('youth status').lean();
    if (!r) return res.status(404).json({ success: false, message: 'Request not found.' });
    if (String(r.youth) !== String(req.user._id)) return res.status(403).json({ success: false, message: 'Not allowed.' });
    if (r.status !== 'pending') return res.status(400).json({ success: false, message: 'Only pending requests can be cancelled.' });

    await MentorshipRequest.updateOne({ _id: r._id }, { $set: { status: 'cancelled', cancelledAt: new Date() } });
    res.json({ success: true });
  } catch (err) {
    console.error('Cancel mentorship request error:', err);
    res.status(500).json({ success: false, message: 'Failed to cancel request.' });
  }
});

// GET /api/mentorship/requests (pastor)
router.get('/requests', protect, requireRoles('pastor', 'super_admin'), async (req, res) => {
  try {
    const role = String(req.user.role || '').toLowerCase();
    const isSuper = role === 'super_admin';
    const schoolId = isSuper && req.query.schoolId ? String(req.query.schoolId) : (req.user.school ? String(req.user.school) : '');
    if (!isSuper && !schoolId) return res.status(400).json({ success: false, message: 'Pastor account missing school.' });

    const status = String(req.query.status || 'pending').toLowerCase();
    const match = { ...(schoolId ? { school: schoolId } : {}) };
    if (status !== 'all') match.status = status;

    const items = await MentorshipRequest.find(match)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('youth', 'firstName lastName email role')
      .populate('pastor', 'firstName lastName role')
      .lean();

    res.json({ success: true, data: items });
  } catch (err) {
    console.error('Mentorship requests inbox error:', err);
    res.status(500).json({ success: false, message: 'Failed to load requests.' });
  }
});

async function updateRequestStatus(req, res, nextStatus) {
  try {
    const r = await MentorshipRequest.findById(req.params.id).lean();
    if (!r) return res.status(404).json({ success: false, message: 'Request not found.' });

    if (String(req.user.role) !== 'super_admin') {
      assertSameSchool(req, { school: r.school });
    }

    if (nextStatus === 'accepted') {
      if (r.status !== 'pending') return res.status(400).json({ success: false, message: 'Only pending requests can be accepted.' });
      await MentorshipRequest.updateOne(
        { _id: r._id },
        { $set: { status: 'accepted', acceptedAt: new Date(), pastor: r.pastor || req.user._id } }
      );
      Notification.create({
        user: r.youth,
        type: 'mentorship_request',
        title: 'Mentorship Request Accepted',
        body: 'A pastor accepted your mentorship request.',
        payload: { requestId: String(r._id) },
      }).catch(() => {});
    }

    if (nextStatus === 'rejected') {
      if (r.status !== 'pending') return res.status(400).json({ success: false, message: 'Only pending requests can be rejected.' });
      await MentorshipRequest.updateOne({ _id: r._id }, { $set: { status: 'rejected', rejectedAt: new Date() } });
      Notification.create({
        user: r.youth,
        type: 'mentorship_request',
        title: 'Mentorship Request Update',
        body: 'Your mentorship request was not accepted at this time.',
        payload: { requestId: String(r._id) },
      }).catch(() => {});
    }

    if (nextStatus === 'closed') {
      if (r.status !== 'accepted') return res.status(400).json({ success: false, message: 'Only accepted requests can be closed.' });
      await MentorshipRequest.updateOne({ _id: r._id }, { $set: { status: 'closed', closedAt: new Date() } });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Mentorship request update error:', err);
    res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Failed to update request.' });
  }
}

router.post('/requests/:id/accept', protect, requireRoles('pastor', 'super_admin'), (req, res) =>
  updateRequestStatus(req, res, 'accepted')
);
router.post('/requests/:id/reject', protect, requireRoles('pastor', 'super_admin'), (req, res) =>
  updateRequestStatus(req, res, 'rejected')
);
router.post('/requests/:id/close', protect, requireRoles('pastor', 'super_admin'), (req, res) =>
  updateRequestStatus(req, res, 'closed')
);

// POST /api/mentorship/sessions (pastor)
// Body: { youthId, requestId?, occurredAt?, durationMinutes?, tags?, privateNotes? }
router.post('/sessions', protect, requireRoles('pastor', 'super_admin'), async (req, res) => {
  try {
    const youthId = req.body && req.body.youthId ? String(req.body.youthId) : '';
    if (!youthId) return res.status(400).json({ success: false, message: 'youthId is required.' });

    const youth = await User.findById(youthId).select('role school').lean();
    if (!youth) return res.status(404).json({ success: false, message: 'Youth not found.' });
    if (youth.role !== 'youth') return res.status(400).json({ success: false, message: 'Target must be a youth user.' });
    assertSameSchool(req, youth);

    const requestId = req.body && req.body.requestId ? String(req.body.requestId) : '';
    let request = null;
    if (requestId) {
      request = await MentorshipRequest.findById(requestId).select('status school youth pastor').lean();
      if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });
      if (String(request.school) !== String(youth.school) || String(request.youth) !== String(youthId)) {
        return res.status(400).json({ success: false, message: 'Request does not match this youth.' });
      }
      if (request.status !== 'accepted') {
        return res.status(400).json({ success: false, message: 'Request must be accepted before logging sessions.' });
      }
    }

    const occurredAt = req.body && req.body.occurredAt ? new Date(req.body.occurredAt) : new Date();
    const durationMinutes = Number.parseInt(String(req.body && req.body.durationMinutes ? req.body.durationMinutes : 30), 10);
    const tags = Array.isArray(req.body && req.body.tags) ? req.body.tags.slice(0, 8).map((t) => safeText(t, 40)).filter(Boolean) : [];
    const privateNotes = safeText(req.body && req.body.privateNotes, 5000);

    const s = await MentorshipSession.create({
      school: youth.school,
      youth: youthId,
      pastor: req.user._id,
      request: request ? request._id : null,
      occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
      durationMinutes: Number.isFinite(durationMinutes) ? Math.max(5, Math.min(240, durationMinutes)) : 30,
      tags,
      privateNotes,
    });

    // Keep existing dashboards alive: increment the youth's mentorshipSessions counter.
    await User.updateOne({ _id: youthId }, { $inc: { mentorshipSessions: 1 }, $set: { lastActive: new Date() } });

    ActivityEvent.create({
      user: req.user._id,
      school: youth.school || null,
      type: 'mentorship_session_logged',
      meta: { youthId, sessionId: String(s._id) },
    }).catch(() => {});

    Notification.create({
      user: youthId,
      type: 'mentorship',
      title: 'Mentorship Session',
      body: 'A mentorship session was logged by your pastor.',
      payload: { sessionId: String(s._id) },
    }).catch(() => {});

    res.json({ success: true, data: { _id: s._id } });
  } catch (err) {
    console.error('Create mentorship session error:', err);
    res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Failed to log session.' });
  }
});

// GET /api/mentorship/sessions/mine (youth) - NO privateNotes
router.get('/sessions/mine', protect, requireRoles('youth'), async (req, res) => {
  try {
    const items = await MentorshipSession.find({ youth: req.user._id })
      .sort({ occurredAt: -1 })
      .limit(50)
      .select('school youth pastor request occurredAt durationMinutes tags createdAt updatedAt') // exclude privateNotes
      .populate('pastor', 'firstName lastName role')
      .lean();
    res.json({ success: true, data: items });
  } catch (err) {
    console.error('My mentorship sessions error:', err);
    res.status(500).json({ success: false, message: 'Failed to load sessions.' });
  }
});

module.exports = router;

