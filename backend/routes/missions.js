const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');

const MissionCompletion = require('../models/missionCompletion');
const BadgeAward = require('../models/badgeAward');
const User = require('../models/user');
const ActivityEvent = require('../models/activityEvent');

// ISO week key: "YYYY-Www"
function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function weeklyMissionsForWeek(weekKey) {
  // Stable but "fresh enough" list. Can be moved to DB later.
  // Keep keys unique across time.
  const base = [
    { key: 'call_friend', title: 'Call a Friend', body: 'Call one person and speak encouragement for 2 minutes.', points: 8 },
    { key: 'family_prayer', title: 'Family Prayer', body: 'Pray together for 5 minutes. Share one gratitude each.', points: 10 },
    { key: 'hidden_kindness', title: 'Hidden Kindness', body: 'Do one kind act quietly, without telling anyone.', points: 8 },
    { key: 'scripture_share', title: 'Share a Verse', body: 'Send one verse to someone and ask how you can pray for them.', points: 7 },
    { key: 'gratitude_three', title: 'Three Gratitudes', body: 'Write 3 things you are thankful for today.', points: 6 },
    { key: 'invite_someone', title: 'Invite Someone', body: 'Invite a friend to an upcoming worship session or group.', points: 9 },
  ];

  // Simple rotation per week key for variety (without losing identity).
  const hash = Math.abs(String(weekKey).split('').reduce((a, c) => a + c.charCodeAt(0), 0));
  const shift = hash % base.length;
  const rotated = base.slice(shift).concat(base.slice(0, shift));
  return rotated;
}

function parseWeekKey(weekKey) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(weekKey || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(week)) return null;
  return { year, week };
}

function weekIndexForKey(weekKey) {
  const p = parseWeekKey(weekKey);
  if (!p) return null;
  return (p.year * 53) + p.week;
}

async function computeWeeklyStreak(userId, currentWeekKey) {
  const currentIdx = weekIndexForKey(currentWeekKey);
  if (currentIdx === null) return 0;

  const weeks = await MissionCompletion.aggregate([
    { $match: { user: userId } },
    { $group: { _id: '$weekKey' } },
  ]);

  const idxSet = new Set(
    weeks
      .map((w) => weekIndexForKey(String(w._id)))
      .filter((x) => x !== null)
  );

  let streak = 0;
  for (let i = currentIdx; idxSet.has(i); i -= 1) streak += 1;
  return streak;
}

async function awardBadgesIfNeeded({ userId, schoolId, weekKey, missionsCount }) {
  const totalDone = await MissionCompletion.countDocuments({ user: userId });
  const doneThisWeek = await MissionCompletion.countDocuments({ user: userId, weekKey });

  const badges = [
    {
      key: 'first_steps',
      at: 1,
      title: 'First Steps',
      description: 'Completed your first mission.',
      bonus: 5,
    },
    {
      key: 'steady_7',
      at: 7,
      title: 'Steady Heart',
      description: 'Completed 7 missions total.',
      bonus: 10,
    },
    {
      key: 'fire_20',
      at: 20,
      title: 'On Fire',
      description: 'Completed 20 missions total.',
      bonus: 20,
    },
  ];

  for (const b of badges) {
    if (totalDone < b.at) continue;
    await BadgeAward.updateOne(
      { user: userId, badgeKey: b.key },
      {
        $setOnInsert: {
          user: userId,
          school: schoolId || null,
          badgeKey: b.key,
          title: b.title,
          description: b.description,
          pointsBonus: b.bonus,
          awardedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  // Weekly badge: complete all missions in the week.
  if (missionsCount > 0 && doneThisWeek >= missionsCount) {
    await BadgeAward.updateOne(
      { user: userId, badgeKey: `week_warrior_${weekKey}` },
      {
        $setOnInsert: {
          user: userId,
          school: schoolId || null,
          badgeKey: `week_warrior_${weekKey}`,
          title: 'Week Warrior',
          description: `Completed all missions for ${weekKey}.`,
          pointsBonus: 25,
          awardedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }
}

// GET /api/missions/week (any logged in)
router.get('/week', protect, async (req, res) => {
  try {
    const weekKey = String(req.query.weekKey || '').trim() || isoWeekKey();
    const missions = weeklyMissionsForWeek(weekKey);

    const done = await MissionCompletion.find({ user: req.user._id, weekKey })
      .select('missionKey points completedAt')
      .lean();
    const completedKeys = done.map((d) => String(d.missionKey));
    const weekPoints = done.reduce((a, d) => a + Number(d.points || 0), 0);

    const [streakWeeks, totalsAgg] = await Promise.all([
      computeWeeklyStreak(req.user._id, weekKey),
      MissionCompletion.aggregate([
        { $match: { user: req.user._id } },
        { $group: { _id: null, points: { $sum: '$points' }, missions: { $sum: 1 } } },
      ]),
    ]);
    const totals = totalsAgg && totalsAgg[0] ? totalsAgg[0] : {};

    const badgeAwards = await BadgeAward.find({ user: req.user._id })
      .sort({ awardedAt: -1 })
      .limit(30)
      .select('badgeKey title description pointsBonus awardedAt')
      .lean();

    res.json({
      success: true,
      data: {
        weekKey,
        missions,
        completedKeys,
        weekPoints,
        streakWeeks,
        allTime: { points: Number(totals.points || 0), missions: Number(totals.missions || 0) },
        badges: badgeAwards,
      },
    });
  } catch (err) {
    console.error('Missions week error:', err);
    res.status(500).json({ success: false, message: 'Failed to load missions.' });
  }
});

// POST /api/missions/complete { missionKey }
router.post('/complete', protect, async (req, res) => {
  try {
    const weekKey = String(req.body?.weekKey || '').trim() || isoWeekKey();
    const missionKey = String(req.body?.missionKey || '').trim().slice(0, 60);
    if (!missionKey) return res.status(400).json({ success: false, message: 'missionKey is required.' });

    const missions = weeklyMissionsForWeek(weekKey);
    const mission = missions.find((m) => String(m.key) === missionKey);
    if (!mission) return res.status(400).json({ success: false, message: 'Unknown mission for this week.' });

    const doc = {
      user: req.user._id,
      school: req.user.school || null,
      weekKey,
      missionKey,
      points: Number(mission.points || 0),
      completedAt: new Date(),
    };

    try {
      await MissionCompletion.create(doc);
    } catch (err) {
      // Duplicate completion is OK.
      if (String(err?.code) !== '11000') throw err;
    }

    await User.updateOne({ _id: req.user._id }, { $set: { lastActive: new Date() } });
    ActivityEvent.create({
      user: req.user._id,
      school: req.user.school || null,
      type: 'mission_completed',
      meta: { weekKey, missionKey },
    }).catch(() => {});

    await awardBadgesIfNeeded({
      userId: req.user._id,
      schoolId: req.user.school || null,
      weekKey,
      missionsCount: missions.length,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Mission complete error:', err);
    res.status(500).json({ success: false, message: 'Failed to record mission.' });
  }
});

// GET /api/missions/leaderboard?scope=school|national&weekKey=YYYY-Www&limit=10
router.get('/leaderboard', protect, async (req, res) => {
  try {
    const weekKey = String(req.query.weekKey || '').trim() || isoWeekKey();
    const scope = String(req.query.scope || 'school').trim().toLowerCase();
    const limit = Math.max(1, Math.min(50, Number.parseInt(String(req.query.limit || '10'), 10) || 10));

    const match = { weekKey };
    if (scope === 'school') match.school = req.user.school;

    const rows = await MissionCompletion.aggregate([
      { $match: match },
      { $group: { _id: '$user', points: { $sum: '$points' }, missions: { $sum: 1 } } },
      { $sort: { points: -1, missions: -1 } },
      { $limit: limit },
    ]);

    const ids = rows.map((r) => r._id);
    const users = await User.find({ _id: { $in: ids } }).select('firstName lastName').lean();
    const map = new Map(users.map((u) => [String(u._id), u]));

    const data = rows.map((r, i) => {
      const u = map.get(String(r._id)) || {};
      const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Member';
      return { rank: i + 1, userId: String(r._id), name, points: Number(r.points || 0), missions: Number(r.missions || 0) };
    });

    res.json({ success: true, data: { weekKey, scope, items: data } });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ success: false, message: 'Failed to load leaderboard.' });
  }
});

module.exports = router;
