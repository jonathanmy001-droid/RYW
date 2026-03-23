const express = require('express');
const router = express.Router();

const { protect, requireRoles } = require('../middleware/authMiddleware');

const Question = require('../models/question');
const User = require('../models/user');
const Notification = require('../models/notification');
const ActivityEvent = require('../models/activityEvent');

function safeText(x, max) {
  return String(x || '').trim().slice(0, max);
}

// POST /api/questions (youth)
// Body: { text, anonymous }
router.post('/', protect, requireRoles('youth'), async (req, res) => {
  try {
    const text = safeText(req.body && req.body.text, 1500);
    const isAnonymous = Boolean(req.body && req.body.anonymous);

    if (!text || text.length < 5) {
      return res.status(400).json({ success: false, message: 'Question must be at least 5 characters.' });
    }

    const q = await Question.create({
      school: req.user.school,
      askedBy: req.user._id,
      text,
      isAnonymous,
      status: 'open',
    });

    // Activity is used for dashboards/insights.
    ActivityEvent.create({
      user: req.user._id,
      school: req.user.school || null,
      type: 'question_asked',
      meta: { questionId: String(q._id) },
    }).catch(() => {});

    // Notify pastors in this school.
    const pastors = await User.find({ role: 'pastor', school: req.user.school, isApproved: true, isLocked: false })
      .select('_id')
      .lean();

    if (pastors.length) {
      const payload = { questionId: String(q._id) };
      const notifs = pastors.map((p) => ({
        user: p._id,
        type: 'qa_question',
        title: 'New Youth Question',
        body: 'A youth submitted a question for guidance.',
        payload,
      }));
      Notification.insertMany(notifs).catch(() => {});
    }

    res.json({ success: true, data: q });
  } catch (err) {
    console.error('Create question error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit question.' });
  }
});

// GET /api/questions/mine (youth)
router.get('/mine', protect, requireRoles('youth'), async (req, res) => {
  try {
    const items = await Question.find({ askedBy: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('answer.answeredBy', 'firstName lastName role')
      .lean();

    res.json({ success: true, data: items });
  } catch (err) {
    console.error('My questions error:', err);
    res.status(500).json({ success: false, message: 'Failed to load questions.' });
  }
});

function resolveSchoolScope(req) {
  const role = String(req.user.role || '').toLowerCase();
  const isSuper = role === 'super_admin';
  const schoolId = isSuper && req.query.schoolId ? String(req.query.schoolId) : (req.user.school ? String(req.user.school) : '');
  return { isSuper, schoolId: schoolId || null };
}

// GET /api/questions/inbox (pastor, super_admin)
// Query: status=open|answered|closed|all, limit
router.get('/inbox', protect, requireRoles('pastor', 'super_admin'), async (req, res) => {
  try {
    const { isSuper, schoolId } = resolveSchoolScope(req);
    if (!isSuper && !schoolId) {
      return res.status(400).json({ success: false, message: 'Pastor account is missing school assignment' });
    }

    const status = String(req.query.status || 'open').toLowerCase();
    const limit = Math.max(1, Math.min(100, Number.parseInt(String(req.query.limit || '30'), 10) || 30));

    const match = { ...(schoolId ? { school: schoolId } : {}) };
    if (status !== 'all') match.status = status;

    const items = await Question.find(match)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('askedBy', 'firstName lastName role')
      .populate('answer.answeredBy', 'firstName lastName role')
      .lean();

    // If anonymous, hide identity in response.
    const sanitized = items.map((q) => {
      if (q.isAnonymous) {
        return { ...q, askedBy: null };
      }
      return q;
    });

    res.json({ success: true, data: sanitized });
  } catch (err) {
    console.error('Inbox questions error:', err);
    res.status(500).json({ success: false, message: 'Failed to load inbox.' });
  }
});

// POST /api/questions/:id/answer (pastor, super_admin)
// Body: { text }
router.post('/:id/answer', protect, requireRoles('pastor', 'super_admin'), async (req, res) => {
  try {
    const text = safeText(req.body && req.body.text, 3000);
    if (!text || text.length < 2) {
      return res.status(400).json({ success: false, message: 'Answer is required.' });
    }

    const q = await Question.findById(req.params.id).lean();
    if (!q) return res.status(404).json({ success: false, message: 'Question not found.' });

    // School guard for pastors.
    if (String(req.user.role) !== 'super_admin') {
      if (!req.user.school) return res.status(400).json({ success: false, message: 'Pastor account missing school' });
      if (String(q.school) !== String(req.user.school)) {
        return res.status(403).json({ success: false, message: 'Cannot answer questions outside your school.' });
      }
    }

    await Question.updateOne(
      { _id: q._id },
      {
        $set: {
          status: 'answered',
          'answer.text': text,
          'answer.answeredBy': req.user._id,
          'answer.answeredAt': new Date(),
        },
      }
    );

    ActivityEvent.create({
      user: req.user._id,
      school: q.school || null,
      type: 'question_answered',
      meta: { questionId: String(q._id) },
    }).catch(() => {});

    // Notify the asking youth (even if anonymous).
    Notification.create({
      user: q.askedBy,
      type: 'qa_answer',
      title: 'Your Question Was Answered',
      body: 'A pastor replied to your question.',
      payload: { questionId: String(q._id) },
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error('Answer question error:', err);
    res.status(500).json({ success: false, message: 'Failed to send answer.' });
  }
});

module.exports = router;

