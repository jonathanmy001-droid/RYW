const express = require('express');
const router = express.Router();

const Reaction = require('../models/reaction');
const { protect } = require('../middleware/authMiddleware');

function clean(str, max = 80) {
  return String(str || '').trim().slice(0, max);
}

// GET /api/reactions/summary?targetType=worship&targetKey=live-featured
router.get('/summary', async (req, res) => {
  try {
    const targetType = clean(req.query.targetType);
    const targetKey = clean(req.query.targetKey);
    if (!targetType || !targetKey) {
      return res.status(400).json({ success: false, message: 'targetType and targetKey are required' });
    }

    const rows = await Reaction.aggregate([
      { $match: { targetType, targetKey } },
      { $group: { _id: '$kind', count: { $sum: 1 } } },
    ]);

    const out = { amen: 0, glory: 0 };
    for (const r of rows) out[String(r._id)] = Number(r.count || 0);
    return res.json({ success: true, data: out });
  } catch (err) {
    console.error('Reaction summary error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load reactions' });
  }
});

// POST /api/reactions/toggle { targetType, targetKey, kind }
router.post('/toggle', protect, async (req, res) => {
  try {
    const targetType = clean(req.body?.targetType);
    const targetKey = clean(req.body?.targetKey);
    const kind = clean(req.body?.kind, 20).toLowerCase();

    if (!targetType || !targetKey) {
      return res.status(400).json({ success: false, message: 'targetType and targetKey are required' });
    }
    if (!['amen', 'glory'].includes(kind)) {
      return res.status(400).json({ success: false, message: 'kind must be amen or glory' });
    }

    const query = { user: req.user._id, targetType, targetKey, kind };
    const existing = await Reaction.findOne(query).select('_id');
    if (existing) {
      await Reaction.deleteOne({ _id: existing._id });
    } else {
      await Reaction.create(query);
    }

    return res.json({ success: true, toggledOn: !existing });
  } catch (err) {
    // Duplicate key means another request created it first.
    if (String(err?.code) === '11000') return res.json({ success: true, toggledOn: true });
    console.error('Reaction toggle error:', err);
    return res.status(500).json({ success: false, message: 'Failed to react' });
  }
});

module.exports = router;

