// backend/routes/admin.js
// Super admin power tools: schools management + audit log.

const express = require('express');
const router = express.Router();

const { protect, superAdmin } = require('../middleware/authMiddleware');
const AuditLog = require('../models/auditLog');
const School = require('../models/school');
const User = require('../models/user');
const Resource = require('../models/resource');
const { migratePrayerGroupsToChat } = require('../services/migratePrayerGroupsToChat');

async function writeAudit({ actorId, action, targetType, targetId = null, meta = {} }) {
  try {
    await AuditLog.create({
      actor: actorId,
      action,
      targetType,
      targetId,
      meta,
    });
  } catch (err) {
    // Never block core admin actions on audit failures.
    console.error('Audit log write failed:', err.message);
  }
}

// GET /api/admin/schools - list all schools
router.get('/schools', protect, superAdmin, async (req, res) => {
  try {
    const schools = await School.find()
      .populate('admin', 'firstName lastName email role')
      .populate('pastor', 'firstName lastName email role')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, count: schools.length, data: schools });
  } catch (err) {
    console.error('List schools error:', err);
    res.status(500).json({ success: false, message: 'Error fetching schools' });
  }
});

// POST /api/admin/migrations/prayer-chat - backfill chat groups + memberships from prayer groups
router.post('/migrations/prayer-chat', protect, superAdmin, async (req, res) => {
  try {
    const result = await migratePrayerGroupsToChat({});

    await writeAudit({
      actorId: req.user._id,
      action: 'migration.prayer_chat',
      targetType: 'System',
      targetId: null,
      meta: result,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Migration prayer-chat error:', err);
    res.status(500).json({ success: false, message: 'Migration failed' });
  }
});

// POST /api/admin/seeds/resources - create starter resources (safe upsert)
router.post('/seeds/resources', protect, superAdmin, async (req, res) => {
  try {
    const seeds = [
      {
        title: 'Beginner Bible Plan (30 days)',
        category: 'bible_plan',
        description: 'A simple 30-day start. Read one chapter daily and write one reflection.',
        url: 'https://www.bible.com/',
      },
      {
        title: 'Worship Starter Playlist',
        category: 'playlist',
        description: 'A daily worship playlist to enter His presence.',
        url: 'https://www.youtube.com/results?search_query=worship+playlist',
      },
      {
        title: 'Prayer Basics Guide',
        category: 'prayer',
        description: 'Learn a simple structure for prayer: praise, repentance, ask, and surrender.',
        url: '',
      },
      {
        title: 'Mentorship: First Session Checklist',
        category: 'mentorship',
        description: 'Questions to ask, goals to set, and how to stay accountable.',
        url: '',
      },
    ];

    let created = 0;
    let existed = 0;
    for (const s of seeds) {
      const r = await Resource.updateOne(
        { title: s.title },
        { $setOnInsert: { ...s, isActive: true, createdBy: req.user._id } },
        { upsert: true }
      );
      if (r.upsertedCount) created += 1;
      else existed += 1;
    }

    const result = { created, existed, totalSeeds: seeds.length };

    await writeAudit({
      actorId: req.user._id,
      action: 'seed.resources',
      targetType: 'System',
      targetId: null,
      meta: result,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Seed resources error:', err);
    res.status(500).json({ success: false, message: 'Seed failed' });
  }
});

// POST /api/admin/schools - create a school
router.post('/schools', protect, superAdmin, async (req, res) => {
  try {
    const { name, province, code } = req.body;
    if (!name || !province) {
      return res.status(400).json({ success: false, message: 'name and province are required' });
    }

    const school = await School.create({
      name: String(name).trim(),
      province: String(province).trim(),
      code: code ? String(code).trim() : undefined,
      isActive: true,
      createdBy: req.user._id,
    });

    await writeAudit({
      actorId: req.user._id,
      action: 'school.create',
      targetType: 'School',
      targetId: school._id,
      meta: { name: school.name, province: school.province },
    });

    res.status(201).json({ success: true, data: school });
  } catch (err) {
    console.error('Create school error:', err);
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'School name already exists' });
    }
    res.status(500).json({ success: false, message: 'Error creating school' });
  }
});

// PATCH /api/admin/schools/:id/active - activate/deactivate a school
router.patch('/schools/:id/active', protect, superAdmin, async (req, res) => {
  try {
    const { isActive } = req.body;
    const school = await School.findById(req.params.id);
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    school.isActive = Boolean(isActive);
    await school.save();

    await writeAudit({
      actorId: req.user._id,
      action: 'school.set_active',
      targetType: 'School',
      targetId: school._id,
      meta: { isActive: school.isActive },
    });

    res.json({ success: true, data: school });
  } catch (err) {
    console.error('Set active error:', err);
    res.status(500).json({ success: false, message: 'Error updating school status' });
  }
});

// PUT /api/admin/schools/:id/assign - assign admin/pastor to a school
router.put('/schools/:id/assign', protect, superAdmin, async (req, res) => {
  try {
    const { adminUserId, pastorUserId } = req.body;
    const school = await School.findById(req.params.id);
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    // Allow explicit unassign by sending null/empty string.
    if (adminUserId === null || adminUserId === '') {
      school.admin = null;
    } else if (adminUserId) {
      const adminUser = await User.findById(adminUserId).select('role school isApproved');
      if (!adminUser) return res.status(404).json({ success: false, message: 'Admin user not found' });
      if (adminUser.role !== 'school_admin') {
        return res.status(400).json({ success: false, message: 'adminUserId must be a school_admin' });
      }
      if (!adminUser.isApproved) {
        return res.status(400).json({ success: false, message: 'Cannot assign an unapproved school_admin' });
      }
      if (String(adminUser.school) !== String(school._id)) {
        return res.status(400).json({ success: false, message: 'school_admin must belong to the same school' });
      }
      school.admin = adminUser._id;
    }

    if (pastorUserId === null || pastorUserId === '') {
      school.pastor = null;
    } else if (pastorUserId) {
      const pastorUser = await User.findById(pastorUserId).select('role school isApproved');
      if (!pastorUser) return res.status(404).json({ success: false, message: 'Pastor user not found' });
      if (pastorUser.role !== 'pastor') {
        return res.status(400).json({ success: false, message: 'pastorUserId must be a pastor' });
      }
      if (!pastorUser.isApproved) {
        return res.status(400).json({ success: false, message: 'Cannot assign an unapproved pastor' });
      }
      if (String(pastorUser.school) !== String(school._id)) {
        return res.status(400).json({ success: false, message: 'pastor must belong to the same school' });
      }
      school.pastor = pastorUser._id;
    }

    await school.save();
    await school.populate('admin', 'firstName lastName email role');
    await school.populate('pastor', 'firstName lastName email role');

    await writeAudit({
      actorId: req.user._id,
      action: 'school.assign_leaders',
      targetType: 'School',
      targetId: school._id,
      meta: {
        adminUserId: adminUserId === undefined ? undefined : (adminUserId || null),
        pastorUserId: pastorUserId === undefined ? undefined : (pastorUserId || null),
      },
    });

    res.json({ success: true, data: school });
  } catch (err) {
    console.error('Assign leaders error:', err);
    res.status(500).json({ success: false, message: 'Error assigning leaders' });
  }
});

// GET /api/admin/users - list users (for admin tooling / dropdowns)
router.get('/users', protect, superAdmin, async (req, res) => {
  try {
    const { role, approved, schoolId, q } = req.query;

    const filter = {};
    if (role) filter.role = String(role);
    if (approved === 'true') filter.isApproved = true;
    if (approved === 'false') filter.isApproved = false;
    if (schoolId) filter.school = schoolId;
    if (q) {
      const term = String(q).trim();
      if (term) {
        filter.$or = [
          { firstName: { $regex: term, $options: 'i' } },
          { lastName: { $regex: term, $options: 'i' } },
          { username: { $regex: term, $options: 'i' } },
          { email: { $regex: term, $options: 'i' } },
        ];
      }
    }

    const users = await User.find(filter)
      .select('firstName lastName email role school isApproved createdAt')
      .populate('school', 'name province')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    res.json({ success: true, count: users.length, data: users });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ success: false, message: 'Error fetching users' });
  }
});

// PATCH /api/admin/users/:id - update user role/school/approval/lock
router.patch('/users/:id', protect, superAdmin, async (req, res) => {
  try {
    const { role, schoolId, isApproved, isLocked, lockedReason } = req.body || {};

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const updates = {};

    if (role !== undefined) {
      const nextRole = String(role);
      const valid = ['youth', 'school_admin', 'pastor', 'super_admin'];
      if (!valid.includes(nextRole)) return res.status(400).json({ success: false, message: 'Invalid role' });
      updates.role = nextRole;
    }

    if (schoolId !== undefined) {
      updates.school = schoolId ? schoolId : null;
    }

    if (isApproved !== undefined) {
      updates.isApproved = Boolean(isApproved);
    }

    if (isLocked !== undefined) {
      const lock = Boolean(isLocked);
      updates.isLocked = lock;
      updates.lockedAt = lock ? new Date() : null;
      updates.lockedReason = lock ? String(lockedReason || '').trim() : '';
    }

    // Enforce: pastor/school_admin must be dedicated to a specific school.
    const effectiveRole = updates.role !== undefined ? updates.role : user.role;
    const effectiveSchool = updates.school !== undefined ? updates.school : user.school;
    if (effectiveRole !== 'super_admin' && !effectiveSchool) {
      return res.status(400).json({ success: false, message: 'This role requires a school assignment' });
    }
    if (effectiveRole === 'super_admin') {
      updates.school = null;
      updates.isApproved = true; // super admin is always approved
    }

    Object.assign(user, updates);
    await user.save();

    await writeAudit({
      actorId: req.user._id,
      action: 'user.update',
      targetType: 'User',
      targetId: user._id,
      meta: { updates: Object.keys(updates) },
    });

    const safe = await User.findById(user._id)
      .select('firstName lastName email username role school isApproved isLocked lockedAt lockedReason createdAt')
      .populate('school', 'name province')
      .lean();

    res.json({ success: true, data: safe });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ success: false, message: 'Error updating user' });
  }
});

// POST /api/admin/users/:id/reset-password - set a new password (super admin)
router.post('/users/:id/reset-password', protect, superAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ success: false, message: 'newPassword must be at least 6 characters' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.password = String(newPassword);
    await user.save();

    await writeAudit({
      actorId: req.user._id,
      action: 'user.reset_password',
      targetType: 'User',
      targetId: user._id,
      meta: {},
    });

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: 'Error resetting password' });
  }
});

// GET /api/admin/audit - recent audit log
router.get('/audit', protect, superAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const logs = await AuditLog.find()
      .populate('actor', 'firstName lastName email role')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, count: logs.length, data: logs });
  } catch (err) {
    console.error('Audit list error:', err);
    res.status(500).json({ success: false, message: 'Error fetching audit log' });
  }
});

module.exports = router;
