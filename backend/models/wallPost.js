const mongoose = require('mongoose');

// Community Wall post used by Family Hub (prayer + gratitude + celebration).
// Notes:
// - `school=null` means national/global.
// - `school=<id>` means school-scoped.
const wallPostSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null, index: true },

    category: {
      type: String,
      enum: ['prayer', 'gratitude', 'celebration'],
      default: 'prayer',
      index: true,
    },

    text: { type: String, required: true, trim: true, maxlength: 1200 },
    isAnonymous: { type: Boolean, default: false },
  },
  { timestamps: true }
);

wallPostSchema.index({ school: 1, category: 1, createdAt: -1 });
wallPostSchema.index({ category: 1, createdAt: -1 });

module.exports = mongoose.model('WallPost', wallPostSchema);

