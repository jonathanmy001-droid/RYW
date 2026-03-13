const express = require('express');
const router = express.Router();

const Notification = require('../models/notification');
const { protect } = require('../middleware/authMiddleware');

// GET /api/notifications?unread=true&limit=50
router.get('/', protect, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const filter = { user: req.user._id };
    if (String(req.query.unread || '') === 'true') {
      filter.readAt = null;
    }

    const items = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    console.error('List notifications error:', err);
    res.status(500).json({ success: false, message: 'Error fetching notifications' });
  }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', protect, async (req, res) => {
  try {
    const n = await Notification.findOne({ _id: req.params.id, user: req.user._id });
    if (!n) return res.status(404).json({ success: false, message: 'Notification not found' });

    n.readAt = new Date();
    await n.save();

    res.json({ success: true, data: n });
  } catch (err) {
    console.error('Read notification error:', err);
    res.status(500).json({ success: false, message: 'Error updating notification' });
  }
});

// POST /api/notifications/mark-all-read
router.post('/mark-all-read', protect, async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
    res.json({ success: true });
  } catch (err) {
    console.error('Mark all read error:', err);
    res.status(500).json({ success: false, message: 'Error updating notifications' });
  }
});

module.exports = router;

