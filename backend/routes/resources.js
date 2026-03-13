const express = require('express');
const router = express.Router();

const Resource = require('../models/resource');
const { protect, requireRoles } = require('../middleware/authMiddleware');

function clampInt(n, min, max) {
  const x = Number.parseInt(String(n), 10);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

// GET /api/resources (public)
router.get('/', async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 1, 50);
    const skip = clampInt(req.query.skip, 0, 2000);
    const category = String(req.query.category || '').trim();

    const query = { isActive: true };
    if (category) query.category = category;

    const items = await Resource.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('title category description url createdAt');

    return res.json({ success: true, data: items });
  } catch (err) {
    console.error('Resources list error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load resources' });
  }
});

// POST /api/resources (super admin)
router.post('/', protect, requireRoles('super_admin'), async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ success: false, message: 'title is required' });

    const category = String(req.body?.category || 'other').trim();
    const description = String(req.body?.description || '').trim();
    const url = String(req.body?.url || '').trim();

    const item = await Resource.create({
      title,
      category,
      description,
      url,
      createdBy: req.user._id,
    });

    return res.status(201).json({ success: true, data: item });
  } catch (err) {
    console.error('Resource create error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create resource' });
  }
});

// PATCH /api/resources/:id (super admin)
router.patch('/:id', protect, requireRoles('super_admin'), async (req, res) => {
  try {
    const updates = {};
    const pick = (k) => (Object.prototype.hasOwnProperty.call(req.body || {}, k) ? req.body[k] : undefined);

    const title = pick('title');
    const description = pick('description');
    const url = pick('url');
    const category = pick('category');
    const isActive = pick('isActive');

    if (title !== undefined) updates.title = String(title || '').trim();
    if (description !== undefined) updates.description = String(description || '').trim();
    if (url !== undefined) updates.url = String(url || '').trim();
    if (category !== undefined) updates.category = String(category || '').trim();
    if (isActive !== undefined) updates.isActive = Boolean(isActive);

    const item = await Resource.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: item });
  } catch (err) {
    console.error('Resource patch error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update resource' });
  }
});

module.exports = router;

