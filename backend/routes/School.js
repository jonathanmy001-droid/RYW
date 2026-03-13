// routes/school.js
const express = require('express');
const router = express.Router();
const { protect, scopeSchool, requireRoles } = require('../middleware/authMiddleware');
const User = require('../models/user');
const Group = require('../models/group');
const ChatGroup = require('../models/chatGroup');
const ChatMessage = require('../models/chatMessage');
const ChatMembership = require('../models/chatMembership');
const Event = require('../models/event');

function isRecentlyActive(lastActive, activeWindowDays = 7) {
  if (!lastActive) return false;
  const cutoff = new Date(Date.now() - activeWindowDays * 24 * 60 * 60 * 1000);
  return new Date(lastActive) >= cutoff;
}

// Get students from THIS admin's school only
router.get('/students', protect, scopeSchool, async (req, res) => {
  try {
    const students = await User.find({ ...req.schoolFilter, role: 'youth' }) // req.schoolFilter is set in authMiddleware
      .select('firstName lastName email school devotionStreak lastActive')
      .lean();

    const enhanced = students.map((s) => ({
      ...s,
      isActive: isRecentlyActive(s.lastActive),
    }));

    res.json(enhanced);
  } catch (err) {
    console.error('Error fetching students:', err);
    res.status(500).json({ message: 'Server error fetching students' });
  }
});

// Create group — only for this school
// GET /api/school/stats - school-scoped metrics for school_admin/pastor (super_admin sees global)
router.get('/stats', protect, scopeSchool, async (req, res) => {
  try {
    const activeWindowDays = 7;
    const cutoff = new Date(Date.now() - activeWindowDays * 24 * 60 * 60 * 1000);

    const baseFilter = { ...req.schoolFilter, role: 'youth' };

    const [totalStudents, activeStudents, groupsCount] = await Promise.all([
      User.countDocuments(baseFilter),
      User.countDocuments({ ...baseFilter, lastActive: { $gte: cutoff } }),
      Group.countDocuments(req.schoolFilter.school ? { school: req.schoolFilter.school } : {}),
    ]);

    // Chat activity (messages in last 7 days)
    let chatMessages7d = 0;
    if (req.schoolFilter.school) {
      const groupIds = await ChatGroup.find({ school: req.schoolFilter.school, isActive: true })
        .select('_id')
        .lean();
      const ids = groupIds.map((g) => g._id);
      if (ids.length) {
        chatMessages7d = await ChatMessage.countDocuments({ group: { $in: ids }, createdAt: { $gte: cutoff } });
      }
    } else {
      // super_admin global view
      chatMessages7d = await ChatMessage.countDocuments({ createdAt: { $gte: cutoff } });
    }

    const now = new Date();
    const upcomingSchoolEvents = req.schoolFilter.school
      ? await Event.countDocuments({ dateTime: { $gte: now }, school: req.schoolFilter.school })
      : await Event.countDocuments({ dateTime: { $gte: now }, school: { $ne: null } });
    const upcomingNationalEvents = await Event.countDocuments({ dateTime: { $gte: now }, school: null });

    const activityAgg = await User.aggregate([
      { $match: { ...baseFilter, lastActive: { $gte: cutoff } } },
      { $group: { _id: { $dayOfWeek: '$lastActive' }, count: { $sum: 1 } } },
    ]);

    // Mongo: 1=Sun..7=Sat. Dashboard wants Mon..Sun.
    const countsByMongoDow = new Map(activityAgg.map((d) => [d._id, d.count]));
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const mongoDowForLabel = { Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7, Sun: 1 };
    const counts = labels.map((label) => countsByMongoDow.get(mongoDowForLabel[label]) || 0);

    res.json({
      totalStudents,
      activeStudents,
      groupsCount,
      chatMessages7d,
      upcomingSchoolEvents,
      upcomingNationalEvents,
      activityByDay: { labels, counts },
      activeWindowDays,
    });
  } catch (err) {
    console.error('Error fetching school stats:', err);
    res.status(500).json({ message: 'Server error fetching stats' });
  }
});

// GET /api/school/groups - list groups for this school
router.get('/groups', protect, scopeSchool, async (req, res) => {
  try {
    const filter = req.schoolFilter.school ? { school: req.schoolFilter.school } : {};
    const groups = await Group.find(filter)
      .select('name description school createdBy members createdAt updatedAt')
      .populate('createdBy', 'firstName lastName email role')
      .populate('members', 'firstName lastName email role')
      .sort({ createdAt: -1 })
      .lean();
    res.json(groups);
  } catch (err) {
    console.error('Error fetching groups:', err);
    res.status(500).json({ message: 'Server error fetching groups' });
  }
});

function assertSameSchoolOrSuper(req, group) {
  if (req.user.role === 'super_admin') return;
  if (!req.user.school) {
    const err = new Error('User has no school assigned');
    err.statusCode = 400;
    throw err;
  }
  if (String(group.school) !== String(req.user.school)) {
    const err = new Error('Access denied - group is outside your school');
    err.statusCode = 403;
    throw err;
  }
}

// GET /api/school/groups/:id - get one group (with members)
router.get('/groups/:id', protect, scopeSchool, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email role')
      .populate('members', 'firstName lastName email role')
      .lean();
    if (!group) return res.status(404).json({ message: 'Group not found' });

    // group is plain object due to lean(); wrap for assertions
    assertSameSchoolOrSuper(req, group);

    res.json(group);
  } catch (err) {
    console.error('Error fetching group:', err);
    res.status(err.statusCode || 500).json({ message: err.message || 'Server error fetching group' });
  }
});

// POST /api/school/groups/:id/members - add youth to group (school scoped)
router.post('/groups/:id/members', protect, scopeSchool, requireRoles('school_admin', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ message: 'userId is required' });

    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    assertSameSchoolOrSuper(req, group);

    const member = await User.findById(userId).select('role school');
    if (!member) return res.status(404).json({ message: 'User not found' });
    if (member.role !== 'youth') return res.status(400).json({ message: 'Only youth users can be added to groups' });
    if (String(member.school) !== String(group.school)) {
      return res.status(400).json({ message: 'User must belong to the same school as the group' });
    }

    await Group.updateOne({ _id: group._id }, { $addToSet: { members: member._id } });

    // Sync: adding youth to prayer group makes them a member of the linked chat group.
    if (group.chatGroup) {
      await ChatMembership.findOneAndUpdate(
        { group: group.chatGroup, user: member._id },
        { $setOnInsert: { roleInGroup: 'member', joinedAt: new Date() }, $set: { status: 'active' } },
        { upsert: true, new: true }
      );
    }

    const updated = await Group.findById(group._id)
      .populate('createdBy', 'firstName lastName email role')
      .populate('members', 'firstName lastName email role')
      .lean();

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Error adding group member:', err);
    res.status(err.statusCode || 500).json({ message: err.message || 'Server error adding member' });
  }
});

// DELETE /api/school/groups/:id/members/:userId - remove youth from group (school scoped)
router.delete('/groups/:id/members/:userId', protect, scopeSchool, requireRoles('school_admin', 'super_admin'), async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    assertSameSchoolOrSuper(req, group);

    await Group.updateOne({ _id: group._id }, { $pull: { members: req.params.userId } });

    // Sync: removing youth from prayer group removes them from linked chat group.
    if (group.chatGroup) {
      await ChatMembership.deleteOne({ group: group.chatGroup, user: req.params.userId });
    }

    const updated = await Group.findById(group._id)
      .populate('createdBy', 'firstName lastName email role')
      .populate('members', 'firstName lastName email role')
      .lean();

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Error removing group member:', err);
    res.status(err.statusCode || 500).json({ message: err.message || 'Server error removing member' });
  }
});

router.post('/groups', protect, requireRoles('school_admin', 'super_admin'), async (req, res) => {
  try {
    const schoolId =
      req.user.role === 'super_admin'
        ? (req.body.schoolId || req.body.school || null)
        : req.user.school;

    if (!schoolId) {
      return res.status(400).json({ message: 'schoolId is required for this action' });
    }

    const group = new Group({
      name: req.body.name,
      description: req.body.description || '',
      school: schoolId,
      createdBy: req.user._id
    });
    await group.save();

    // Create matching chat group (so every prayer group has a real chat room).
    const chatGroup = await ChatGroup.create({
      name: group.name,
      description: group.description || '',
      school: group.school,
      visibility: 'school_only',
      joinPolicy: 'invite_only',
      isDiscoverable: true,
      isActive: true,
      createdBy: req.user._id,
      lastMessageAt: null,
    });

    await ChatMembership.create({
      group: chatGroup._id,
      user: req.user._id,
      roleInGroup: 'owner',
      status: 'active',
    });

    group.chatGroup = chatGroup._id;
    await group.save();

    res.status(201).json(group);
  } catch (err) {
    console.error('Error creating group:', err);
    res.status(500).json({ message: 'Server error creating group' });
  }
});

module.exports = router;
