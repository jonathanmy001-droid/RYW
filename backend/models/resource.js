const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    category: {
      type: String,
      enum: ['bible_plan', 'playlist', 'prayer', 'mentorship', 'teaching', 'other'],
      default: 'other',
      index: true,
    },
    description: { type: String, trim: true, default: '', maxlength: 600 },
    url: { type: String, trim: true, default: '' }, // external or internal link

    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

resourceSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model('Resource', resourceSchema);

