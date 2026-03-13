// ================================================
//          models/User.js
// ================================================
// Defines the schema and model for a User.
// Includes password hashing and comparison logic.

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true
  },
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: 3
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/.+\@.+\..+/, 'Please fill a valid email address']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6
  },
  role: {
    type: String,
    enum: ['youth', 'school_admin', 'pastor', 'super_admin'],
    default: 'youth'
  },
  school: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School', // Reference to the School model
    required: function() {
      return this.role !== 'super_admin';
    }
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  isLocked: {
    type: Boolean,
    default: false
  },
  lockedAt: {
    type: Date,
    default: null
  },
  lockedReason: {
    type: String,
    default: ''
  },

  // Dashboard-facing activity fields (stored in DB so dashboards can show real data)
  devotionStreak: {
    type: Number,
    default: 0,
    min: 0
  },
  prayersAnswered: {
    type: Number,
    default: 0,
    min: 0
  },
  mentorshipSessions: {
    type: Number,
    default: 0,
    min: 0
  },
  lastActive: {
    type: Date,
    default: null
  },

  // Profile fields (optional)
  bio: {
    type: String,
    trim: true,
    default: '',
    maxlength: 500
  },
  phone: {
    type: String,
    trim: true,
    default: '',
    maxlength: 30
  },
  avatarUrl: {
    type: String,
    trim: true,
    default: ''
  },
  preferredLanguage: {
    type: String,
    enum: ['rw', 'en'],
    default: 'rw'
  }
}, {
  timestamps: true // Automatically adds createdAt and updatedAt fields
});

// Middleware to hash password before saving
// Note: with Mongoose promise-style middleware, do not use `next()`.
userSchema.pre('save', async function() {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare candidate password with the hashed password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
