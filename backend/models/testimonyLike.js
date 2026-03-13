const mongoose = require('mongoose');

const testimonyLikeSchema = new mongoose.Schema(
  {
    testimony: { type: mongoose.Schema.Types.ObjectId, ref: 'Testimony', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true }
);

testimonyLikeSchema.index({ testimony: 1, user: 1 }, { unique: true });
testimonyLikeSchema.index({ testimony: 1, createdAt: -1 });

module.exports = mongoose.model('TestimonyLike', testimonyLikeSchema);

