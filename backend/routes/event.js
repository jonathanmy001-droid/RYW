// backend/routes/event.js
// Worship events API (school-scoped).

const express = require('express');
const multer = require('multer');

const router = express.Router();
const Event = require('../models/event');
const Notification = require('../models/notification');
const User = require('../models/user');
const EventRsvp = require('../models/eventRsvp');
const { protect, anyAdmin, requireRoles } = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');

function buildUpcomingFilter({ schoolId }) {
  const now = new Date();
  if (!schoolId) return { dateTime: { $gte: now } };
  return {
    dateTime: { $gte: now },
    $or: [{ school: schoolId }, { school: null }],
  };
}

// GET /api/events/upcoming (public)
// Optional: ?schoolId=<id> to include school events + national events.
router.get('/upcoming', async (req, res) => {
  try {
    const schoolId = req.query.schoolId ? String(req.query.schoolId) : null;
    const filter = buildUpcomingFilter({ schoolId });

    const events = await Event.find(filter)
      .sort({ dateTime: 1 })
      .limit(20)
      .populate('postedBy', 'firstName lastName email role')
      .populate('school', 'name province')
      .lean();

    const ids = events.map((e) => e._id);
    const counts = await EventRsvp.aggregate([
      { $match: { event: { $in: ids }, status: 'going' } },
      { $group: { _id: '$event', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
    const enriched = events.map((e) => ({ ...e, rsvpCount: countMap.get(String(e._id)) || 0 }));

    res.json({ success: true, count: enriched.length, data: enriched });
  } catch (err) {
    console.error('Error fetching upcoming events:', err);
    res.status(500).json({ success: false, message: 'Could not fetch events' });
  }
});

// GET /api/events/upcoming/mine (protected)
// Youth: sees their school + national events.
// Admin/Pastor: same.
// Super Admin: sees all.
router.get('/upcoming/mine', protect, async (req, res) => {
  try {
    const now = new Date();
    const filter =
      req.user.role === 'super_admin'
        ? { dateTime: { $gte: now } }
        : {
            dateTime: { $gte: now },
            $or: [{ school: req.user.school }, { school: null }],
          };

    const events = await Event.find(filter)
      .sort({ dateTime: 1 })
      .limit(20)
      .populate('postedBy', 'firstName lastName email role')
      .populate('school', 'name province')
      .lean();

    const ids = events.map((e) => e._id);
    const counts = await EventRsvp.aggregate([
      { $match: { event: { $in: ids }, status: 'going' } },
      { $group: { _id: '$event', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
    const enriched = events.map((e) => ({ ...e, rsvpCount: countMap.get(String(e._id)) || 0 }));

    res.json({ success: true, count: enriched.length, data: enriched });
  } catch (err) {
    console.error('Error fetching my upcoming events:', err);
    res.status(500).json({ success: false, message: 'Could not fetch events' });
  }
});

// POST /api/events/:id/rsvp (protected) - youth/admin can RSVP
router.post('/:id/rsvp', protect, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).select('_id school dateTime');
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

    // Basic rule: youth can RSVP to any public event (national or other schools),
    // but notifications are only school-based.
    const statusRaw = req.body && req.body.status ? String(req.body.status) : 'going';
    const status = ['going', 'interested', 'not_going'].includes(statusRaw) ? statusRaw : 'going';

    const rsvp = await EventRsvp.findOneAndUpdate(
      { event: event._id, user: req.user._id },
      { $set: { status } },
      { upsert: true, new: true }
    ).lean();

    res.json({ success: true, data: rsvp });
  } catch (err) {
    console.error('RSVP error:', err);
    res.status(500).json({ success: false, message: 'Could not RSVP' });
  }
});

// GET /api/events/:id/rsvp/me (protected)
router.get('/:id/rsvp/me', protect, async (req, res) => {
  try {
    const rsvp = await EventRsvp.findOne({ event: req.params.id, user: req.user._id }).lean();
    res.json({ success: true, data: rsvp || null });
  } catch (err) {
    console.error('My RSVP error:', err);
    res.status(500).json({ success: false, message: 'Could not fetch RSVP' });
  }
});

// GET /api/events/:id/rsvps (admin/pastor) - list RSVP for an event
router.get('/:id/rsvps', protect, anyAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 200), 500);
    const items = await EventRsvp.find({ event: req.params.id, status: { $ne: 'not_going' } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('user', 'firstName lastName email role school')
      .lean();
    res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    console.error('List RSVPs error:', err);
    res.status(500).json({ success: false, message: 'Could not fetch RSVPs' });
  }
});

// POST /api/events (protected, admin/pastor)
// Optional poster upload via Cloudinary.
router.post('/', protect, anyAdmin, upload, async (req, res) => {
  try {
    const { title, dateTime, description } = req.body || {};

    if (!title || !dateTime || !description) {
      return res.status(400).json({ success: false, message: 'title, dateTime, and description are required' });
    }

    const eventDate = new Date(dateTime);
    if (Number.isNaN(eventDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format for dateTime' });
    }

    const schoolId =
      req.user.role === 'super_admin'
        ? (req.body.schoolId ? String(req.body.schoolId) : null)
        : req.user.school;

    const eventData = {
      title: String(title).trim(),
      dateTime: eventDate,
      description: String(description).trim(),
      postedBy: req.user._id,
      school: schoolId || null,
      poster: req.file ? req.file.path : null,
    };

    const event = await Event.create(eventData);
    await event.populate('postedBy', 'firstName lastName email role');
    await event.populate('school', 'name province');

    // Notify users in the school (school events only)
    if (event.school) {
      const recipients = await User.find({ school: event.school }).select('_id').lean();
      if (recipients.length) {
        const docs = recipients.map((u) => ({
          user: u._id,
          type: 'event.school_created',
          title: 'New school event',
          body: event.title,
          payload: { eventId: String(event._id), schoolId: String(event.school) },
        }));
        Notification.insertMany(docs, { ordered: false }).catch(() => {});
      }
    }

    res.status(201).json({ success: true, message: 'Event posted successfully', data: event });
  } catch (err) {
    console.error('Error creating event:', err);

    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: err.message || 'File upload error' });
    }

    res.status(400).json({ success: false, message: err.message || 'Invalid event data' });
  }
});

// GET /api/events/mine (protected) - events posted by the current admin/pastor
router.get('/mine', protect, anyAdmin, async (req, res) => {
  try {
    const events = await Event.find({ postedBy: req.user._id })
      .sort({ dateTime: -1 })
      .limit(50)
      .populate('school', 'name province')
      .lean();

    res.json({ success: true, count: events.length, data: events });
  } catch (err) {
    console.error('Error fetching my events:', err);
    res.status(500).json({ success: false, message: 'Could not fetch events' });
  }
});

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Worship Events API',
    info: 'GET /api/events/upcoming or GET /api/events/upcoming/mine',
  });
});

module.exports = router;
