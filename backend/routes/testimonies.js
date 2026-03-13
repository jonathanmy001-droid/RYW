const express = require('express');
const router = express.Router();

const Testimony = require('../models/testimony');
const TestimonyLike = require('../models/testimonyLike');
const { protect } = require('../middleware/authMiddleware');

function clampInt(n, min, max) {
  const x = Number.parseInt(String(n), 10);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

// GET /api/testimonies (public)
router.get('/', async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 1, 50);
    const skip = clampInt(req.query.skip, 0, 2000);
    const schoolId = String(req.query.schoolId || '').trim();

    const match = {};
    if (schoolId) match.school = schoolId;

    const rows = await Testimony.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'testimonylikes',
          localField: '_id',
          foreignField: 'testimony',
          as: 'likes',
        },
      },
      { $addFields: { likeCount: { $size: '$likes' } } },
      { $project: { likes: 0 } },
    ]);

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Testimonies list error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load testimonies' });
  }
});

// POST /api/testimonies (any logged-in user)
router.post('/', protect, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ success: false, message: 'text is required' });
    const isAnonymous = Boolean(req.body?.isAnonymous);

    const item = await Testimony.create({
      user: req.user._id,
      school: req.user.school || null,
      text,
      isAnonymous,
    });

    return res.status(201).json({ success: true, data: item });
  } catch (err) {
    console.error('Testimony create error:', err);
    return res.status(500).json({ success: false, message: 'Failed to post testimony' });
  }
});

// POST /api/testimonies/:id/like (toggle)
router.post('/:id/like', protect, async (req, res) => {
  try {
    const testimonyId = req.params.id;
    const existing = await TestimonyLike.findOne({ testimony: testimonyId, user: req.user._id }).select('_id');
    if (existing) {
      await TestimonyLike.deleteOne({ _id: existing._id });
      return res.json({ success: true, liked: false });
    }
    await TestimonyLike.create({ testimony: testimonyId, user: req.user._id });
    return res.json({ success: true, liked: true });
  } catch (err) {
    if (String(err?.code) === '11000') return res.json({ success: true, liked: true });
    console.error('Testimony like error:', err);
    return res.status(500).json({ success: false, message: 'Failed to like' });
  }
});

module.exports = router;

