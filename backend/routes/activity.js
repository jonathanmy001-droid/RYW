const express = require('express');
const router = express.Router();

const ActivityEvent = require('../models/activityEvent');
const User = require('../models/user');
const { protect } = require('../middleware/authMiddleware');

async function record(req, type, meta = {}) {
  try {
    await ActivityEvent.create({
      user: req.user._id,
      school: req.user.school || null,
      type,
      meta,
    });
  } catch (err) {
    // Do not block user actions.
    console.error('Activity record failed:', err.message);
  }
}

// POST /api/activity/ping (any logged in)
router.post('/ping', protect, async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $set: { lastActive: new Date() } });
  await record(req, 'ping', {});
  res.json({ success: true });
});

// POST /api/activity/devotion-done (youth)
router.post('/devotion-done', protect, async (req, res) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $inc: { devotionStreak: 1 }, $set: { lastActive: new Date() } });
    await record(req, 'devotion_done', {});
    res.json({ success: true });
  } catch (err) {
    console.error('Devotion done error:', err);
    res.status(500).json({ success: false, message: 'Error recording devotion' });
  }
});

// POST /api/activity/prayer-answered (youth/pastor)
router.post('/prayer-answered', protect, async (req, res) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $inc: { prayersAnswered: 1 }, $set: { lastActive: new Date() } });
    await record(req, 'prayer_answered', {});
    res.json({ success: true });
  } catch (err) {
    console.error('Prayer answered error:', err);
    res.status(500).json({ success: false, message: 'Error recording prayer' });
  }
});

// POST /api/activity/mentorship-session (pastor)
router.post('/mentorship-session', protect, async (req, res) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $inc: { mentorshipSessions: 1 }, $set: { lastActive: new Date() } });
    await record(req, 'mentorship_session', {});
    res.json({ success: true });
  } catch (err) {
    console.error('Mentorship session error:', err);
    res.status(500).json({ success: false, message: 'Error recording session' });
  }
});

// POST /api/activity/joy-challenge-done (any logged in)
router.post('/joy-challenge-done', protect, async (req, res) => {
  try {
    const key = String(req.body?.key || '').trim().slice(0, 40);
    await User.updateOne({ _id: req.user._id }, { $set: { lastActive: new Date() } });
    await record(req, 'joy_challenge_done', { key });
    res.json({ success: true });
  } catch (err) {
    console.error('Joy challenge error:', err);
    res.status(500).json({ success: false, message: 'Error recording challenge' });
  }
});

module.exports = router;
