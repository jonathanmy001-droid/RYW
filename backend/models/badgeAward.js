const mongoose = require('mongoose');

// A badge awarded to a user (persisted in DB).
const badgeAwardSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null, index: true },

    badgeKey: { type: String, required: true, trim: true, index: true },
    title: { type: String, default: '', trim: true, maxlength: 80 },
    description: { type: String, default: '', trim: true, maxlength: 180 },

    pointsBonus: { type: Number, default: 0, min: 0, max: 500 },
    awardedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

badgeAwardSchema.index({ user: 1, badgeKey: 1 }, { unique: true });
badgeAwardSchema.index({ awardedAt: -1 });

module.exports = mongoose.model('BadgeAward', badgeAwardSchema);

