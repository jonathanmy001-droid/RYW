const express = require('express');
const router = express.Router();

const ContactMessage = require('../models/contactMessage');
const NewsletterSubscriber = require('../models/newsletterSubscriber');
const WallPost = require('../models/wallPost');

function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function weeklyMissionsForWeek(weekKey) {
  const base = [
    { key: 'call_friend', title: 'Call a Friend', body: 'Call one person and speak encouragement for 2 minutes.', points: 8 },
    { key: 'family_prayer', title: 'Family Prayer', body: 'Pray together for 5 minutes. Share one gratitude each.', points: 10 },
    { key: 'hidden_kindness', title: 'Hidden Kindness', body: 'Do one kind act quietly, without telling anyone.', points: 8 },
    { key: 'scripture_share', title: 'Share a Verse', body: 'Send one verse to someone and ask how you can pray for them.', points: 7 },
    { key: 'gratitude_three', title: 'Three Gratitudes', body: 'Write 3 things you are thankful for today.', points: 6 },
    { key: 'invite_someone', title: 'Invite Someone', body: 'Invite a friend to an upcoming worship session or group.', points: 9 },
  ];
  const hash = Math.abs(String(weekKey).split('').reduce((a, c) => a + c.charCodeAt(0), 0));
  const shift = hash % base.length;
  return base.slice(shift).concat(base.slice(0, shift));
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// POST /api/public/contact
router.post('/contact', async (req, res) => {
  try {
    const { name, email, subject, message, source } = req.body || {};

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }
    if (!message || String(message).trim().length < 10) {
      return res.status(400).json({ success: false, message: 'Message must be at least 10 characters' });
    }

    await ContactMessage.create({
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      subject: String(subject || '').trim(),
      message: String(message).trim(),
      source: String(source || 'website').trim(),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').slice(0, 80),
    });

    res.status(201).json({ success: true, message: 'Message received. We will respond soon.' });
  } catch (err) {
    console.error('Public contact error:', err);
    res.status(500).json({ success: false, message: 'Could not send message' });
  }
});

// POST /api/public/subscribe
router.post('/subscribe', async (req, res) => {
  try {
    const { email, source } = req.body || {};
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }

    const normalized = String(email).trim().toLowerCase();

    await NewsletterSubscriber.updateOne(
      { email: normalized },
      { $setOnInsert: { email: normalized, source: String(source || 'website').trim(), subscribedAt: new Date() } },
      { upsert: true }
    );

    res.status(201).json({ success: true, message: 'Subscribed successfully' });
  } catch (err) {
    console.error('Public subscribe error:', err);
    res.status(500).json({ success: false, message: 'Could not subscribe' });
  }
});

// GET /api/public/daily-challenge
// Lightweight "sticky" feature for Family Hub without DB dependency.
router.get('/daily-challenge', async (req, res) => {
  try {
    const challenges = [
      { key: 'call_friend', title: 'Call a Friend', body: 'Call one person and speak encouragement for 2 minutes.' },
      { key: 'family_prayer', title: 'Family Prayer', body: 'Pray together for 5 minutes. Share one gratitude each.' },
      { key: 'kindness', title: 'Hidden Kindness', body: 'Do one kind act quietly, without telling anyone.' },
      { key: 'scripture_voice', title: 'Scripture Voice Note', body: 'Record 20 seconds reading a verse and send it to someone.' },
      { key: 'forgive', title: 'Release & Forgive', body: 'Write one sentence forgiving someone. Keep it private.' },
      { key: 'gratitude_three', title: 'Three Gratitudes', body: 'Write 3 things you are thankful for today.' },
      { key: 'invite', title: 'Invite Someone', body: 'Invite a friend to an upcoming worship session or group.' },
    ];

    const today = new Date();
    const dayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const idx = Math.abs(dayKey.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % challenges.length;
    const c = challenges[idx];

    res.json({
      success: true,
      data: {
        date: dayKey,
        ...c,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load daily challenge.' });
  }
});

// GET /api/public/wall?category=prayer|gratitude|celebration|all&limit=20
// Public feed is national-only (school=null).
router.get('/wall', async (req, res) => {
  try {
    const category = String(req.query.category || 'all').trim().toLowerCase();
    const limit = Math.max(1, Math.min(50, Number.parseInt(String(req.query.limit || '20'), 10) || 20));

    const match = { school: null };
    if (['prayer', 'gratitude', 'celebration'].includes(category)) match.category = category;

    const items = await WallPost.find(match)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('user', 'firstName lastName role')
      .lean();

    const sanitized = items.map((p) => (p.isAnonymous ? { ...p, user: null } : p));
    res.json({ success: true, data: sanitized });
  } catch (err) {
    console.error('Public wall error:', err);
    res.status(500).json({ success: false, message: 'Failed to load public wall.' });
  }
});

// GET /api/public/weekly-missions
router.get('/weekly-missions', async (req, res) => {
  try {
    const weekKey = String(req.query.weekKey || '').trim() || isoWeekKey();
    const missions = weeklyMissionsForWeek(weekKey);
    res.json({ success: true, data: { weekKey, missions } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load weekly missions.' });
  }
});

module.exports = router;
