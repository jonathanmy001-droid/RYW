const express = require('express');
const router = express.Router();

const { protect, requireRoles } = require('../middleware/authMiddleware');

const User = require('../models/user');
const ActivityEvent = require('../models/activityEvent');
const JournalEntry = require('../models/journalEntry');
const Testimony = require('../models/testimony');
const ChatGroup = require('../models/chatGroup');
const ChatMessage = require('../models/chatMessage');
const Event = require('../models/event');
const EventRsvp = require('../models/eventRsvp');
const Notification = require('../models/notification');

function clampInt(n, min, max) {
  const x = Number.parseInt(String(n), 10);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function schoolScopeFromReq(req) {
  const isSuper = req.user.role === 'super_admin';
  const schoolId = isSuper && req.query.schoolId ? String(req.query.schoolId) : (req.user.school ? String(req.user.school) : '');
  return { isSuper, schoolId: schoolId || null };
}

// GET /api/pastor/overview (pastor, super_admin)
// Pastor: scoped to their school (counts/aggregates only).
// Super Admin: can pass ?schoolId=... for a school overview, or omit for global overview.
router.get('/overview', protect, requireRoles('pastor', 'super_admin'), async (req, res) => {
  try {
    const activeDays = clampInt(req.query.activeDays, 1, 60);
    const days = clampInt(req.query.days, 1, 90);
    const now = new Date();
    const activeCutoff = new Date(Date.now() - activeDays * 24 * 60 * 60 * 1000);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const { isSuper, schoolId } = schoolScopeFromReq(req);
    if (!isSuper && !schoolId) {
      return res.status(400).json({ success: false, message: 'Pastor account is missing school assignment' });
    }

    const userMatch = { role: 'youth', ...(schoolId ? { school: schoolId } : {}) };
    const docSchoolMatch = schoolId ? { school: schoolId } : {};

    const [
      totalYouth,
      activeYouth,
      userAgg,
      streakBuckets,
      journalCount,
      testimonyCount,
      activityTypes,
      activityByDay,
      mentorshipByDay,
      topActiveYouth,
      chatGroupsCount,
      chatMessagesCount,
      upcomingSchoolEvents,
      upcomingNationalEvents,
      schoolUpcomingEvents,
    ] = await Promise.all([
      User.countDocuments(userMatch),
      User.countDocuments({ ...userMatch, lastActive: { $gte: activeCutoff } }),
      User.aggregate([
        { $match: userMatch },
        {
          $group: {
            _id: null,
            devotionAvg: { $avg: '$devotionStreak' },
            devotionSum: { $sum: '$devotionStreak' },
            prayersAnsweredSum: { $sum: '$prayersAnswered' },
            mentorshipSessionsSum: { $sum: '$mentorshipSessions' },
          },
        },
      ]),
      User.aggregate([
        { $match: userMatch },
        {
          $bucket: {
            groupBy: '$devotionStreak',
            boundaries: [0, 1, 7, 21, 1000000],
            default: 'unknown',
            output: { count: { $sum: 1 } },
          },
        },
      ]),
      JournalEntry.countDocuments({ ...docSchoolMatch, createdAt: { $gte: cutoff } }),
      Testimony.countDocuments({ ...docSchoolMatch, createdAt: { $gte: cutoff } }),
      ActivityEvent.aggregate([
        { $match: { ...docSchoolMatch, createdAt: { $gte: cutoff } } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ActivityEvent.aggregate([
        { $match: { ...docSchoolMatch, createdAt: { $gte: cutoff } } },
        { $group: { _id: { $dayOfWeek: '$createdAt' }, count: { $sum: 1 } } },
      ]),
      ActivityEvent.aggregate([
        { $match: { ...docSchoolMatch, type: 'mentorship_session_logged', createdAt: { $gte: cutoff } } },
        { $group: { _id: { $dayOfWeek: '$createdAt' }, count: { $sum: 1 } } },
      ]),
      User.find(userMatch)
        .sort({ lastActive: -1, devotionStreak: -1 })
        .limit(5)
        .select('firstName lastName email devotionStreak prayersAnswered mentorshipSessions lastActive')
        .lean(),
      ChatGroup.countDocuments(schoolId ? { school: schoolId, isActive: true } : { isActive: true }),
      (async () => {
        if (!schoolId) return ChatMessage.countDocuments({ createdAt: { $gte: cutoff } });
        const groupIds = await ChatGroup.find({ school: schoolId, isActive: true }).select('_id').lean();
        const ids = groupIds.map((g) => g._id);
        if (!ids.length) return 0;
        return ChatMessage.countDocuments({ group: { $in: ids }, createdAt: { $gte: cutoff } });
      })(),
      schoolId ? Event.countDocuments({ school: schoolId, dateTime: { $gte: now } }) : Event.countDocuments({ school: { $ne: null }, dateTime: { $gte: now } }),
      Event.countDocuments({ school: null, dateTime: { $gte: now } }),
      schoolId
        ? Event.find({ school: schoolId, dateTime: { $gte: now } })
            .sort({ dateTime: 1 })
            .limit(10)
            .select('title dateTime school')
            .lean()
        : Promise.resolve([]),
    ]);

    const agg = userAgg && userAgg[0] ? userAgg[0] : {};
    const bucketMap = new Map(streakBuckets.map((b) => [String(b._id), Number(b.count || 0)]));
    const streakDistribution = {
      '0': bucketMap.get('0') || 0,
      '1-6': bucketMap.get('1') || 0,
      '7-20': bucketMap.get('7') || 0,
      '21+': bucketMap.get('21') || 0,
    };

    // Mongo: 1=Sun..7=Sat. UI wants Mon..Sun.
    const countsByMongoDow = new Map(activityByDay.map((d) => [d._id, d.count]));
    const mentorshipCountsByMongoDow = new Map(mentorshipByDay.map((d) => [d._id, d.count]));
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const mongoDowForLabel = { Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7, Sun: 1 };
    const counts = labels.map((label) => countsByMongoDow.get(mongoDowForLabel[label]) || 0);
    const mentorshipCounts = labels.map((label) => mentorshipCountsByMongoDow.get(mongoDowForLabel[label]) || 0);

    // Event engagement (RSVP going counts for upcoming school events)
    let eventEngagement = [];
    if (schoolUpcomingEvents && schoolUpcomingEvents.length) {
      const ids = schoolUpcomingEvents.map((e) => e._id);
      const rsvpCounts = await EventRsvp.aggregate([
        { $match: { event: { $in: ids }, status: 'going' } },
        { $group: { _id: '$event', count: { $sum: 1 } } },
      ]);
      const map = new Map(rsvpCounts.map((c) => [String(c._id), Number(c.count || 0)]));
      eventEngagement = schoolUpcomingEvents.map((e) => ({
        _id: e._id,
        title: e.title,
        dateTime: e.dateTime,
        rsvpGoing: map.get(String(e._id)) || 0,
      }));
    }

    res.json({
      success: true,
      data: {
        scope: { schoolId: schoolId || null, activeDays, days },
        youth: { total: totalYouth, active: activeYouth },
        devotion: {
          avgStreak: Math.round(Number(agg.devotionAvg || 0) * 10) / 10,
          totalStreakDays: Number(agg.devotionSum || 0),
          distribution: streakDistribution,
        },
        prayer: { totalAnswered: Number(agg.prayersAnsweredSum || 0) },
        mentorship: { totalSessions: Number(agg.mentorshipSessionsSum || 0) },
        journal: { entries: Number(journalCount || 0) },
        testimonies: { posts: Number(testimonyCount || 0) },
        chat: { groups: Number(chatGroupsCount || 0), messages: Number(chatMessagesCount || 0) },
        events: { upcomingSchool: Number(upcomingSchoolEvents || 0), upcomingNational: Number(upcomingNationalEvents || 0) },
        engagement: { activityByDay: { labels, counts }, mentorshipByDay: { labels, counts: mentorshipCounts }, topActiveYouth, eventEngagement },
        activity: activityTypes.map((x) => ({ type: x._id, count: x.count })),
      },
    });
  } catch (err) {
    console.error('Pastor overview error:', err);
    res.status(500).json({ success: false, message: 'Failed to load pastor overview' });
  }
});

// POST /api/pastor/mentorship/log { youthId }
// Logs a mentorship session and increments the youth's mentorshipSessions counter.
router.post('/mentorship/log', protect, requireRoles('pastor', 'super_admin'), async (req, res) => {
  try {
    const youthId = req.body && req.body.youthId ? String(req.body.youthId) : '';
    if (!youthId) return res.status(400).json({ success: false, message: 'youthId is required' });

    const youth = await User.findById(youthId).select('role school mentorshipSessions firstName lastName email').lean();
    if (!youth) return res.status(404).json({ success: false, message: 'Youth not found' });
    if (youth.role !== 'youth') return res.status(400).json({ success: false, message: 'Target must be a youth user' });

    const isSuper = req.user.role === 'super_admin';
    const pastorSchool = req.user.school ? String(req.user.school) : '';
    if (!isSuper) {
      if (!pastorSchool) return res.status(400).json({ success: false, message: 'Pastor account missing school' });
      if (String(youth.school) !== pastorSchool) {
        return res.status(403).json({ success: false, message: 'Cannot log mentorship for youth outside your school' });
      }
    }

    await User.updateOne({ _id: youthId }, { $inc: { mentorshipSessions: 1 }, $set: { lastActive: new Date() } });

    // Record activity (counts only, no sensitive content).
    ActivityEvent.create({
      user: req.user._id,
      school: youth.school || null,
      type: 'mentorship_session_logged',
      meta: { youthId },
    }).catch(() => {});

    // Optional: notify the youth.
    Notification.create({
      user: youthId,
      title: 'Mentorship Session',
      body: 'A mentorship session was logged by your pastor.',
      type: 'mentorship',
      payload: { youthId, pastorId: String(req.user._id) },
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) {
    console.error('Mentorship log error:', err);
    res.status(500).json({ success: false, message: 'Failed to log mentorship session' });
  }
});

module.exports = router;
