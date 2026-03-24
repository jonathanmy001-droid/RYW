const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');

const WallPost = require('../models/wallPost');
const Notification = require('../models/notification');
const ActivityEvent = require('../models/activityEvent');

function safeText(x, max) {
  return String(x || '').trim().slice(0, max);
}

function cleanEnum(x, allowed, fallback) {
  const v = String(x || '').trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

// GET /api/wall/posts?scope=national|school|all&category=prayer|gratitude|celebration|all&limit=30
// Auth required because school-scoped content is based on req.user.school.
router.get('/posts', protect, async (req, res) => {
  try {
    const scope = cleanEnum(req.query.scope, ['national', 'school', 'all'], 'school');
    const category = cleanEnum(req.query.category, ['prayer', 'gratitude', 'celebration', 'all'], 'all');
    const limit = Math.max(1, Math.min(80, Number.parseInt(String(req.query.limit || '30'), 10) || 30));

    const match = {};
    if (scope === 'national') match.school = null;
    if (scope === 'school') match.school = req.user.school;
    if (scope === 'all') match.$or = [{ school: null }, { school: req.user.school }];
    if (category !== 'all') match.category = category;

    const items = await WallPost.find(match)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('user', 'firstName lastName role')
      .lean();

    const sanitized = items.map((p) => {
      if (p.isAnonymous) return { ...p, user: null };
      return p;
    });

    res.json({ success: true, data: sanitized });
  } catch (err) {
    console.error('Wall posts error:', err);
    res.status(500).json({ success: false, message: 'Failed to load wall posts.' });
  }
});

// POST /api/wall/posts
// Body: { text, category, scope, anonymous }
router.post('/posts', protect, async (req, res) => {
  try {
    const text = safeText(req.body && req.body.text, 1200);
    const category = cleanEnum(req.body && req.body.category, ['prayer', 'gratitude', 'celebration'], 'prayer');
    const scope = cleanEnum(req.body && req.body.scope, ['national', 'school'], 'school');
    const isAnonymous = Boolean(req.body && req.body.anonymous);

    if (!text || text.length < 5) {
      return res.status(400).json({ success: false, message: 'Post must be at least 5 characters.' });
    }

    const school = (scope === 'national') ? null : req.user.school;

    const post = await WallPost.create({
      user: req.user._id,
      school,
      category,
      text,
      isAnonymous,
    });

    ActivityEvent.create({
      user: req.user._id,
      school: req.user.school || null,
      type: 'wall_post_created',
      meta: { postId: String(post._id), scope, category },
    }).catch(() => {});

    // Soft notify: only for school posts (keeps national feed calm).
    if (school) {
      Notification.create({
        user: req.user._id,
        type: 'wall_post',
        title: 'Wall Post Published',
        body: 'Your message is live in your school wall.',
        payload: { postId: String(post._id), category },
      }).catch(() => {});
    }

    res.status(201).json({ success: true, data: post });
  } catch (err) {
    console.error('Create wall post error:', err);
    res.status(500).json({ success: false, message: 'Failed to create post.' });
  }
});

module.exports = router;

