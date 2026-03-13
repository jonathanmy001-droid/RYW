// backend/models/event.js
// Worship event model (school-scoped, with optional national events).

const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Event must have a title'],
      trim: true,
      maxlength: [100, 'Title too long'],
    },
    dateTime: {
      type: Date,
      required: [true, 'Event must have date and time'],
    },
    description: {
      type: String,
      required: [true, 'Describe the event for youth guidance'],
      trim: true,
    },

    // Cloudinary secure URL (optional)
    poster: {
      type: String,
      default: null,
    },

    // School scoping:
    // - school_admin/pastor events are automatically tied to their school
    // - super_admin can create "national" events with school=null (default)
    school: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      default: null,
    },

    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

eventSchema.index({ dateTime: 1 });
eventSchema.index({ school: 1, dateTime: 1 });

module.exports = mongoose.model('Event', eventSchema);

