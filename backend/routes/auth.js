// backend/routes/auth.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/user');     // Capital U – make sure file is User.js
const School = require('../models/school'); // Capital S – make sure file is School.js
const Event = require('../models/event');   // Import Event model for stats
const bcrypt = require('bcryptjs');
const { protect, superAdmin, scopeSchool, requireRoles } = require('../middleware/authMiddleware');
const ActivityEvent = require('../models/activityEvent');
const ChatMessage = require('../models/chatMessage');
const EventRsvp = require('../models/eventRsvp');

// Helper: Generate JWT
const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role, school: user.school },
    process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-2026',
    { expiresIn: '7d' }
  );
};

// GET /api/auth/me (any logged-in user)
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password')
      .populate('school', 'name province');

    if (!user) return res.status(404).json({ message: 'User not found' });

    // Lightweight computed stats for “alive” dashboards
    const [messagesSent, eventsJoined] = await Promise.all([
      ChatMessage.countDocuments({ user: user._id }),
      EventRsvp.countDocuments({ user: user._id, status: 'going' }),
    ]);

    const u = user.toObject();
    u.messagesSent = Number(messagesSent || 0);
    u.eventsJoined = Number(eventsJoined || 0);

    res.json({ user: u });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ message: 'Error fetching profile' });
  }
});

// PATCH /api/auth/me (any logged-in user) - update profile fields
router.patch('/me', protect, async (req, res) => {
  try {
    const updates = {};
    const pick = (k) => (Object.prototype.hasOwnProperty.call(req.body || {}, k) ? req.body[k] : undefined);

    const bio = pick('bio');
    const phone = pick('phone');
    const avatarUrl = pick('avatarUrl');
    const preferredLanguage = pick('preferredLanguage');

    if (bio !== undefined) updates.bio = String(bio || '').trim().slice(0, 500);
    if (phone !== undefined) updates.phone = String(phone || '').trim().slice(0, 30);
    if (avatarUrl !== undefined) updates.avatarUrl = String(avatarUrl || '').trim();
    if (preferredLanguage !== undefined) {
      const lang = String(preferredLanguage || '').trim().toLowerCase();
      updates.preferredLanguage = (lang === 'en') ? 'en' : 'rw';
    }

    const user = await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true })
      .select('-password')
      .populate('school', 'name province');

    if (!user) return res.status(404).json({ message: 'User not found' });

    const [messagesSent, eventsJoined] = await Promise.all([
      ChatMessage.countDocuments({ user: user._id }),
      EventRsvp.countDocuments({ user: user._id, status: 'going' }),
    ]);

    const u = user.toObject();
    u.messagesSent = Number(messagesSent || 0);
    u.eventsJoined = Number(eventsJoined || 0);

    res.json({ success: true, user: u });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ message: 'Error updating profile' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, username, email, password, schoolId, newSchoolName, province, role } = req.body;

    if (!firstName || !lastName || !username || !email || !password) {
      return res.status(400).json({ message: 'All required fields must be filled' });
    }

    let user = await User.findOne({ $or: [{ email }, { username }] });
    if (user) {
      return res.status(400).json({ message: 'Email or username already exists' });
    }

    let assignedSchool;

    if (schoolId) {
      assignedSchool = await School.findById(schoolId);
      if (!assignedSchool) {
        return res.status(404).json({ message: 'Selected school not found' });
      }
    } else if (newSchoolName && province) {
      const existingSchool = await School.findOne({ name: newSchoolName });
      if (existingSchool) {
        return res.status(400).json({ message: 'School name already exists' });
      }

      const newSchool = new School({
        name: newSchoolName,
        province,
        isActive: false,
        createdBy: null
      });
      assignedSchool = await newSchool.save();
    } else {
      return res.status(400).json({ message: 'Please select or request a school' });
    }

    // Determine role & approval status
    // Default to 'youth' if not specified or invalid
    const validRoles = ['youth', 'school_admin', 'pastor'];
    const userRole = (role && validRoles.includes(role)) ? role : 'youth';
    
    // Only youth are auto-approved. Admins/Pastors need Super Admin approval.
    const isApproved = userRole === 'youth';

    user = new User({
      firstName,
      lastName,
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      password,
      school: assignedSchool._id,
      role: userRole,
      isApproved: isApproved
    });

    await user.save();

    // If user is not approved (e.g. school_admin), do not send token yet
    if (!isApproved) {
      return res.status(201).json({
        message: 'Registration successful! Your account is pending approval by a Super Admin.',
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          email: user.email,
          role: user.role,
          school: assignedSchool.name,
          isApproved: false
        }
      });
    }

    const token = generateToken(user);

    res.status(201).json({
      message: 'Registration successful! Welcome to Rwandan Youth Worship.',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        email: user.email,
        role: user.role,
        school: assignedSchool.name,
        isApproved: true
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// POST /api/auth/login  ← ADDED THIS ROUTE
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ message: 'Email/Username and password required' });
    }

    const user = await User.findOne({
      $or: [{ email: identifier.toLowerCase() }, { username: identifier.toLowerCase() }]
    });

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (user.isLocked) {
      return res.status(403).json({ message: 'Account is locked. Contact a Super Admin.' });
    }

    if (user.role !== 'youth' && !user.isApproved) {
      return res.status(403).json({ message: 'Account not yet approved by admin' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Mark as active (used by dashboards)
    await User.updateOne({ _id: user._id }, { $set: { lastActive: new Date() } });

    // Record real activity for stats
    ActivityEvent.create({
      user: user._id,
      school: user.school || null,
      type: 'login',
      meta: {},
    }).catch(() => {});

    const token = generateToken(user);

    res.json({
      message: 'Login successful – Welcome back to the sanctuary!',
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        email: user.email,
        role: user.role,
        school: user.school
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// GET /api/auth/schools
router.get('/schools', async (req, res) => {
  try {
    const schools = await School.find({ isActive: true }).select('name province');
    res.json(schools);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching schools' });
  }
});

// ────────────────────────────────────────────────
// SUPER ADMIN CONTROLS
// ────────────────────────────────────────────────

// GET /api/auth/pending (Super Admin & School Admin)
router.get('/pending', protect, scopeSchool, requireRoles('school_admin', 'super_admin'), async (req, res) => {
  try {
    // Fetch users who are NOT approved and NOT youth (youth are auto-approved)
    const query = { 
      ...req.schoolFilter, 
      isApproved: false, 
      role: { $ne: 'youth' } 
    };
    const pendingUsers = await User.find(query)
      .populate('school', 'name province')
      .select('-password');
    res.json(pendingUsers);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching pending users' });
  }
});

// GET /api/auth/users (Super Admin & School Admin) - List all users
router.get('/users', protect, scopeSchool, requireRoles('school_admin', 'super_admin'), async (req, res) => {
  try {
    const users = await User.find(req.schoolFilter)
      .select('-password')
      .populate('school', 'name province')
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// PUT /api/auth/approve/:id (Super Admin only)
router.put('/approve/:id', protect, superAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { isApproved: true }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: `User ${user.username} has been approved!`, user });
  } catch (err) {
    res.status(500).json({ message: 'Error approving user' });
  }
});

// GET /api/auth/admin/stats (Super Admin & School Admin) - Professional Analytics
router.get('/admin/stats', protect, scopeSchool, requireRoles('school_admin', 'super_admin'), async (req, res) => {
  try {
    const isSuper = req.user.role === 'super_admin';

    // 1. Total Users (scoped by school for school_admin)
    const totalUsers = await User.countDocuments(req.schoolFilter);

    // 2. Total Schools
    // Super Admin: All schools
    // School Admin: 1 (Their school)
    const totalSchools = isSuper ? await School.countDocuments() : 1;

    // 3. Total Events
    // Super Admin: All events
    // School Admin: Events for their school
    const eventQuery = isSuper ? {} : { school: req.user.school };
    const totalEvents = await Event.countDocuments(eventQuery);

    // 4. Pending Users
    // Super Admin: All pending non-youth users
    // School Admin: Pending users in their school (if any)
    const pendingQuery = { 
      ...req.schoolFilter, 
      isApproved: false, 
      role: { $ne: 'youth' } 
    };
    const pendingUsers = await User.countDocuments(pendingQuery);

    // 5. Users by Role (scoped)
    const usersByRole = await User.aggregate([
      { $match: req.schoolFilter },
      { $group: { _id: "$role", count: { $sum: 1 } } }
    ]);

    res.json({
      totalUsers, totalSchools, totalEvents, pendingUsers, usersByRole
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ message: 'Error fetching admin stats' });
  }
});

module.exports = router;
