const express = require('express');
const router = express.Router();

const ChatGroup = require('../models/chatGroup');
const ChatMembership = require('../models/chatMembership');
const ChatMessage = require('../models/chatMessage');
const ActivityEvent = require('../models/activityEvent');
const User = require('../models/user');

const { protect, requireRoles } = require('../middleware/authMiddleware');

async function recordActivity(req, type, meta = {}) {
  try {
    await ActivityEvent.create({ user: req.user._id, school: req.user.school || null, type, meta });
  } catch (err) {
    console.error('Activity record failed:', err.message);
  }
}

function assertSchoolScope(req, group) {
  if (req.user.role === 'super_admin') return;
  if (!req.user.school) {
    const err = new Error('User has no school assigned');
    err.statusCode = 400;
    throw err;
  }
  if (group.school && String(group.school) !== String(req.user.school)) {
    const err = new Error('Access denied - group is outside your school');
    err.statusCode = 403;
    throw err;
  }
}

async function getMembership(groupId, userId) {
  return ChatMembership.findOne({ group: groupId, user: userId }).lean();
}

function isActiveMember(m) {
  if (!m) return false;
  if (m.status === 'banned' || m.status === 'pending') return false;
  return true;
}

// POST /api/chat/groups
// school_admin/pastor can create groups for their school.
// super_admin can create national groups by sending { visibility:'national', schoolId:null }.
router.post('/groups', protect, requireRoles('school_admin', 'pastor', 'super_admin'), async (req, res) => {
  try {
    const { name, description, joinPolicy, visibility, isDiscoverable, schoolId } = req.body || {};
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });

    const isSuper = req.user.role === 'super_admin';
    const effectiveVisibility = visibility === 'national' ? 'national' : 'school_only';

    let effectiveSchool = null;
    if (effectiveVisibility === 'school_only') {
      effectiveSchool = isSuper ? (schoolId || null) : req.user.school;
      if (!effectiveSchool) {
        return res.status(400).json({ success: false, message: 'schoolId is required for school_only groups' });
      }
    } else {
      // national group
      if (!isSuper) return res.status(403).json({ success: false, message: 'Only super_admin can create national groups' });
      effectiveSchool = null;
    }

    const group = await ChatGroup.create({
      name: String(name).trim(),
      description: String(description || '').trim(),
      joinPolicy: ['invite_only', 'request_to_join', 'open'].includes(joinPolicy) ? joinPolicy : 'invite_only',
      visibility: effectiveVisibility,
      isDiscoverable: isDiscoverable === undefined ? true : Boolean(isDiscoverable),
      school: effectiveSchool,
      createdBy: req.user._id,
    });

    // Creator becomes owner
    await ChatMembership.create({
      group: group._id,
      user: req.user._id,
      roleInGroup: 'owner',
      status: 'active',
    });

    res.status(201).json({ success: true, data: group });
  } catch (err) {
    console.error('Create group error:', err);
    res.status(500).json({ success: false, message: 'Error creating group' });
  }
});

// GET /api/chat/groups
// Returns groups the user is a member of, plus discoverable school groups (if allowed).
router.get('/groups', protect, async (req, res) => {
  try {
    // Include pending so youth can see "Pending approval" in their MY tab.
    const myMemberships = await ChatMembership.find({ user: req.user._id, status: { $in: ['active', 'muted', 'pending'] } })
      .select('group status roleInGroup')
      .lean();
    const myGroupIds = myMemberships.map((m) => m.group);

    const base = { isActive: true };

    let query;
    if (req.user.role === 'super_admin') {
      query = { ...base };
    } else if (req.user.role === 'school_admin' || req.user.role === 'pastor') {
      // Admin/pastor oversight: see all groups in their school (even invite-only), plus national groups.
      query = { ...base, $or: [{ visibility: 'national' }, { school: req.user.school }] };
    } else {
      // Youth: discoverable groups (including invite_only) + groups they are already a member of.
      query = {
        ...base,
        $and: [
          { $or: [{ visibility: 'national' }, { school: req.user.school }] },
          {
            $or: [
              { _id: { $in: myGroupIds } },
              { isDiscoverable: true },
            ],
          },
        ],
      };
    }

    const groups = await ChatGroup.find(query)
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .limit(200)
      .lean();

    const membershipMap = new Map(myMemberships.map((m) => [String(m.group), m]));
    const enriched = groups.map((g) => {
      const m = membershipMap.get(String(g._id));
      return { ...g, membership: m || null };
    });

    res.json({ success: true, count: enriched.length, data: enriched });
  } catch (err) {
    console.error('List groups error:', err);
    res.status(500).json({ success: false, message: 'Error fetching groups' });
  }
});

// POST /api/chat/groups/:id/join
router.post('/groups/:id/join', protect, async (req, res) => {
  try {
    const group = await ChatGroup.findById(req.params.id).lean();
    if (!group || !group.isActive) return res.status(404).json({ success: false, message: 'Group not found' });

    // Enforce scope (school or national)
    if (group.visibility !== 'national') {
      assertSchoolScope(req, group);
    }

    if (group.joinPolicy === 'invite_only') {
      return res.status(403).json({ success: false, message: 'This group is invite-only' });
    }

    const status = group.joinPolicy === 'request_to_join' ? 'pending' : 'active';

    const membership = await ChatMembership.findOneAndUpdate(
      { group: group._id, user: req.user._id },
      { $setOnInsert: { roleInGroup: 'member', joinedAt: new Date() }, $set: { status } },
      { upsert: true, new: true }
    );

    await recordActivity(req, 'join_group', { groupId: String(group._id), status });

    res.json({ success: true, data: membership });
  } catch (err) {
    console.error('Join group error:', err);
    res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Error joining group' });
  }
});

// POST /api/chat/groups/:id/invite { userId }
router.post('/groups/:id/invite', protect, requireRoles('school_admin', 'pastor', 'super_admin'), async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ success: false, message: 'userId is required' });

    const group = await ChatGroup.findById(req.params.id).lean();
    if (!group || !group.isActive) return res.status(404).json({ success: false, message: 'Group not found' });
    if (group.visibility !== 'national') assertSchoolScope(req, group);

    // Only owner/moderator can invite (school_admin/pastor is allowed if same school)
    const inviterMembership = await getMembership(group._id, req.user._id);
    const isSuper = req.user.role === 'super_admin';
    const canInviteByMembership = inviterMembership && ['owner', 'moderator'].includes(inviterMembership.roleInGroup);
    const canInviteByRole = req.user.role === 'school_admin' || req.user.role === 'pastor' || isSuper;
    if (!canInviteByMembership && !canInviteByRole) {
      return res.status(403).json({ success: false, message: 'Not allowed to invite members' });
    }

    const memberUser = await User.findById(userId).select('school role').lean();
    if (!memberUser) return res.status(404).json({ success: false, message: 'User not found' });

    if (group.visibility !== 'national' && String(memberUser.school) !== String(group.school)) {
      return res.status(400).json({ success: false, message: 'User must belong to the same school as the group' });
    }

    const membership = await ChatMembership.findOneAndUpdate(
      { group: group._id, user: memberUser._id },
      { $setOnInsert: { roleInGroup: 'member', joinedAt: new Date() }, $set: { status: 'active' } },
      { upsert: true, new: true }
    );

    res.json({ success: true, data: membership });
  } catch (err) {
    console.error('Invite error:', err);
    res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Error inviting user' });
  }
});

// PATCH /api/chat/groups/:id/members/:userId { status, roleInGroup, mutedUntil }
router.patch('/groups/:id/members/:userId', protect, requireRoles('school_admin', 'pastor', 'super_admin'), async (req, res) => {
  try {
    const group = await ChatGroup.findById(req.params.id).lean();
    if (!group || !group.isActive) return res.status(404).json({ success: false, message: 'Group not found' });
    if (group.visibility !== 'national') assertSchoolScope(req, group);

    const actorMembership = await getMembership(group._id, req.user._id);
    const isSuper = req.user.role === 'super_admin';
    const canModerateByMembership = actorMembership && ['owner', 'moderator'].includes(actorMembership.roleInGroup);
    const canModerateByRole = req.user.role === 'school_admin' || req.user.role === 'pastor' || isSuper;
    if (!canModerateByMembership && !canModerateByRole) {
      return res.status(403).json({ success: false, message: 'Not allowed to moderate members' });
    }

    const updates = {};
    if (req.body.status) {
      const s = String(req.body.status);
      if (!['active', 'pending', 'banned', 'muted'].includes(s)) {
        return res.status(400).json({ success: false, message: 'Invalid status' });
      }
      updates.status = s;
    }
    if (req.body.roleInGroup) {
      const r = String(req.body.roleInGroup);
      if (!['owner', 'moderator', 'member'].includes(r)) {
        return res.status(400).json({ success: false, message: 'Invalid roleInGroup' });
      }
      // Only owner/super can promote to moderator/owner
      const isOwner = actorMembership && actorMembership.roleInGroup === 'owner';
      if (!isSuper && !isOwner) {
        return res.status(403).json({ success: false, message: 'Only group owner can change roles' });
      }
      updates.roleInGroup = r;
    }
    if (req.body.mutedUntil !== undefined) {
      updates.mutedUntil = req.body.mutedUntil ? new Date(req.body.mutedUntil) : null;
    }

    const membership = await ChatMembership.findOneAndUpdate(
      { group: group._id, user: req.params.userId },
      { $set: updates },
      { new: true }
    );
    if (!membership) return res.status(404).json({ success: false, message: 'Membership not found' });

    res.json({ success: true, data: membership });
  } catch (err) {
    console.error('Moderate member error:', err);
    res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Error updating membership' });
  }
});

// DELETE /api/chat/groups/:id/members/:userId (remove member)
router.delete('/groups/:id/members/:userId', protect, requireRoles('school_admin', 'pastor', 'super_admin'), async (req, res) => {
  try {
    const group = await ChatGroup.findById(req.params.id).lean();
    if (!group || !group.isActive) return res.status(404).json({ success: false, message: 'Group not found' });
    if (group.visibility !== 'national') assertSchoolScope(req, group);

    const actorMembership = await getMembership(group._id, req.user._id);
    const isSuper = req.user.role === 'super_admin';
    const canRemoveByMembership = actorMembership && ['owner', 'moderator'].includes(actorMembership.roleInGroup);
    const canRemoveByRole = req.user.role === 'school_admin' || req.user.role === 'pastor' || isSuper;
    if (!canRemoveByMembership && !canRemoveByRole) {
      return res.status(403).json({ success: false, message: 'Not allowed to remove members' });
    }

    // Prevent removing the group owner by non-super admins (safety).
    const target = await ChatMembership.findOne({ group: group._id, user: req.params.userId }).lean();
    if (!target) return res.status(404).json({ success: false, message: 'Membership not found' });
    if (!isSuper && target.roleInGroup === 'owner') {
      return res.status(403).json({ success: false, message: 'Cannot remove group owner' });
    }

    await ChatMembership.deleteOne({ group: group._id, user: req.params.userId });
    res.json({ success: true });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Error removing member' });
  }
});

// GET /api/chat/groups/:id/messages?before=<iso>&limit=50
router.get('/groups/:id/messages', protect, async (req, res) => {
  try {
    const group = await ChatGroup.findById(req.params.id).lean();
    if (!group || !group.isActive) return res.status(404).json({ success: false, message: 'Group not found' });
    if (group.visibility !== 'national') assertSchoolScope(req, group);

    const membership = await getMembership(group._id, req.user._id);
    if (!isActiveMember(membership)) {
      return res.status(403).json({ success: false, message: 'You are not a member of this group' });
    }

    const limit = Math.min(Number(req.query.limit || 50), 100);
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    const filter = { group: group._id };
    if (before && !Number.isNaN(before.getTime())) {
      filter.createdAt = { $lt: before };
    }

    const items = await ChatMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('sender', 'firstName lastName email role')
      .lean();

    res.json({ success: true, count: items.length, data: items.reverse() });
  } catch (err) {
    console.error('List messages error:', err);
    res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Error fetching messages' });
  }
});

// GET /api/chat/groups/:id/members
router.get('/groups/:id/members', protect, async (req, res) => {
  try {
    const group = await ChatGroup.findById(req.params.id).lean();
    if (!group || !group.isActive) return res.status(404).json({ success: false, message: 'Group not found' });
    if (group.visibility !== 'national') assertSchoolScope(req, group);

    const isSuper = req.user.role === 'super_admin';
    const actorMembership = await getMembership(group._id, req.user._id);
    const canSeeByRole = req.user.role === 'school_admin' || req.user.role === 'pastor' || isSuper;
    const canSeeByMembership = actorMembership && actorMembership.status !== 'banned' && actorMembership.status !== 'pending';
    if (!canSeeByRole && !canSeeByMembership) {
      return res.status(403).json({ success: false, message: 'Not allowed to view members' });
    }

    const members = await ChatMembership.find({ group: group._id })
      .populate('user', 'firstName lastName email role school')
      .sort({ roleInGroup: 1, createdAt: 1 })
      .lean();

    res.json({ success: true, count: members.length, data: members });
  } catch (err) {
    console.error('List group members error:', err);
    res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Error fetching members' });
  }
});

// GET /api/chat/groups/:id/requests (pending join requests)
router.get('/groups/:id/requests', protect, requireRoles('school_admin', 'pastor', 'super_admin'), async (req, res) => {
  try {
    const group = await ChatGroup.findById(req.params.id).lean();
    if (!group || !group.isActive) return res.status(404).json({ success: false, message: 'Group not found' });
    if (group.visibility !== 'national') assertSchoolScope(req, group);

    // Owner/moderator or school leadership can review requests.
    const actorMembership = await getMembership(group._id, req.user._id);
    const isSuper = req.user.role === 'super_admin';
    const canReviewByMembership = actorMembership && ['owner', 'moderator'].includes(actorMembership.roleInGroup);
    const canReviewByRole = req.user.role === 'school_admin' || req.user.role === 'pastor' || isSuper;
    if (!canReviewByMembership && !canReviewByRole) {
      return res.status(403).json({ success: false, message: 'Not allowed to review requests' });
    }

    const items = await ChatMembership.find({ group: group._id, status: 'pending' })
      .populate('user', 'firstName lastName email role school')
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();

    res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    console.error('List join requests error:', err);
    res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Error fetching requests' });
  }
});

// POST /api/chat/groups/:id/requests/:userId/approve
router.post('/groups/:id/requests/:userId/approve', protect, requireRoles('school_admin', 'pastor', 'super_admin'), async (req, res) => {
  try {
    const group = await ChatGroup.findById(req.params.id).lean();
    if (!group || !group.isActive) return res.status(404).json({ success: false, message: 'Group not found' });
    if (group.visibility !== 'national') assertSchoolScope(req, group);

    const actorMembership = await getMembership(group._id, req.user._id);
    const isSuper = req.user.role === 'super_admin';
    const canReviewByMembership = actorMembership && ['owner', 'moderator'].includes(actorMembership.roleInGroup);
    const canReviewByRole = req.user.role === 'school_admin' || req.user.role === 'pastor' || isSuper;
    if (!canReviewByMembership && !canReviewByRole) {
      return res.status(403).json({ success: false, message: 'Not allowed to approve requests' });
    }

    const m = await ChatMembership.findOneAndUpdate(
      { group: group._id, user: req.params.userId, status: 'pending' },
      { $set: { status: 'active' } },
      { new: true }
    );
    if (!m) return res.status(404).json({ success: false, message: 'Pending request not found' });

    res.json({ success: true });
  } catch (err) {
    console.error('Approve request error:', err);
    res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Error approving request' });
  }
});

// POST /api/chat/groups/:id/requests/:userId/reject
router.post('/groups/:id/requests/:userId/reject', protect, requireRoles('school_admin', 'pastor', 'super_admin'), async (req, res) => {
  try {
    const group = await ChatGroup.findById(req.params.id).lean();
    if (!group || !group.isActive) return res.status(404).json({ success: false, message: 'Group not found' });
    if (group.visibility !== 'national') assertSchoolScope(req, group);

    const actorMembership = await getMembership(group._id, req.user._id);
    const isSuper = req.user.role === 'super_admin';
    const canReviewByMembership = actorMembership && ['owner', 'moderator'].includes(actorMembership.roleInGroup);
    const canReviewByRole = req.user.role === 'school_admin' || req.user.role === 'pastor' || isSuper;
    if (!canReviewByMembership && !canReviewByRole) {
      return res.status(403).json({ success: false, message: 'Not allowed to reject requests' });
    }

    // Strong anti-spam: mark as banned instead of deleting.
    const m = await ChatMembership.findOneAndUpdate(
      { group: group._id, user: req.params.userId, status: 'pending' },
      { $set: { status: 'banned' } },
      { new: true }
    );
    if (!m) return res.status(404).json({ success: false, message: 'Pending request not found' });

    res.json({ success: true });
  } catch (err) {
    console.error('Reject request error:', err);
    res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Error rejecting request' });
  }
});

// POST /api/chat/groups/:id/messages { text }
router.post('/groups/:id/messages', protect, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ success: false, message: 'text is required' });
    }

    const group = await ChatGroup.findById(req.params.id);
    if (!group || !group.isActive) return res.status(404).json({ success: false, message: 'Group not found' });
    if (group.visibility !== 'national') assertSchoolScope(req, group);

    const membership = await ChatMembership.findOne({ group: group._id, user: req.user._id }).lean();
    if (!isActiveMember(membership)) {
      return res.status(403).json({ success: false, message: 'You are not a member of this group' });
    }

    if (membership.status === 'muted') {
      const mutedUntil = membership.mutedUntil ? new Date(membership.mutedUntil) : null;
      if (mutedUntil && mutedUntil > new Date()) {
        return res.status(403).json({ success: false, message: 'You are muted in this group' });
      }
    }

    const msg = await ChatMessage.create({
      group: group._id,
      sender: req.user._id,
      text: String(text).trim(),
    });

    group.lastMessageAt = new Date();
    await group.save();

    await recordActivity(req, 'send_message', { groupId: String(group._id) });

    const hydrated = await ChatMessage.findById(msg._id)
      .populate('sender', 'firstName lastName email role')
      .lean();

    res.status(201).json({ success: true, data: hydrated });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Error sending message' });
  }
});

module.exports = router;
