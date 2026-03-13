const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const JournalEntry = require('../models/journalEntry');

function clampInt(n, min, max) {
  const x = Number.parseInt(String(n), 10);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

// POST /api/journal (any logged-in user)
router.post('/', protect, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ success: false, message: 'Reflection text is required' });

    const moodRaw = String(req.body?.mood || '').trim().toLowerCase();
    const mood = ['blessed', 'comfort', 'battle', 'neutral'].includes(moodRaw) ? moodRaw : 'neutral';

    const entry = await JournalEntry.create({
      user: req.user._id,
      school: req.user.school || null,
      promptTitle: String(req.body?.promptTitle || '').trim(),
      promptRef: String(req.body?.promptRef || '').trim(),
      promptText: String(req.body?.promptText || '').trim(),
      mood,
      text,
    });

    return res.status(201).json({ success: true, data: entry });
  } catch (err) {
    console.error('Journal create error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save reflection' });
  }
});

// GET /api/journal/mine (any logged-in user)
router.get('/mine', protect, async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 1, 50);
    const skip = clampInt(req.query.skip, 0, 1000);

    const items = await JournalEntry.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('promptTitle promptRef mood text createdAt');

    return res.json({ success: true, data: items });
  } catch (err) {
    console.error('Journal list error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load reflections' });
  }
});

module.exports = router;

