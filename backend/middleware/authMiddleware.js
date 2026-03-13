// backend/middleware/authMiddleware.js
// ================================================
// Protect routes and enforce role-based access (RBAC).
//
// Separation of concerns:
// - `scopeSchool`: adds req.schoolFilter for school-scoped queries (school_admin/pastor). super_admin is unscoped.
// - `requireRoles(...)`: explicit permission gates (prevents role leaks).

const jwt = require('jsonwebtoken');
const User = require('../models/user');

// Must match the secret used when generating tokens in routes/auth.js.
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-2026';

const requireRoles = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Please login first' });
  }
  if (roles.includes(req.user.role)) return next();
  return res.status(403).json({
    success: false,
    message: `Access denied - requires role: ${roles.join(', ')}`,
  });
};

// 1. Protect - must be logged in
const protect = async (req, res, next) => {
  const auth = req.headers.authorization || '';
  const hasBearer = auth.startsWith('Bearer ');
  const token = hasBearer ? auth.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized - please login first' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');

    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authorized - user no longer exists' });
    }

    if (req.user.isLocked) {
      return res.status(403).json({ success: false, message: 'Account is locked - contact a Super Admin' });
    }

    // Platform invariant: all roles except super_admin must be dedicated to a school.
    if (req.user.role !== 'super_admin' && !req.user.school) {
      return res.status(403).json({
        success: false,
        message: 'Account is missing a school assignment. Contact a Super Admin.',
      });
    }

    return next();
  } catch (error) {
    console.error('Token error:', error.message);
    return res.status(401).json({ success: false, message: 'Not authorized - invalid or expired token' });
  }
};

// 2. School scoping (NOT a permission check).
// - school_admin/pastor: req.schoolFilter={school:<their school>}
// - super_admin: req.schoolFilter={}
const scopeSchool = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Please login first' });
  }

  if (req.user.role === 'super_admin') {
    req.schoolFilter = {};
    return next();
  }

  if (req.user.role === 'school_admin' || req.user.role === 'pastor') {
    req.schoolFilter = { school: req.user.school };
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Access denied - only school admins, pastors, or super admins allowed here',
  });
};

// Backwards compatibility: older routes import `schoolAdmin` for school scoping.
const schoolAdmin = scopeSchool;

// 3. Super Admin only
const superAdmin = requireRoles('super_admin');

// 4. Any Admin (school_admin OR super_admin OR pastor)
const anyAdmin = requireRoles('school_admin', 'super_admin', 'pastor');

module.exports = {
  protect,
  scopeSchool,
  schoolAdmin,
  requireRoles,
  superAdmin,
  anyAdmin,
};

