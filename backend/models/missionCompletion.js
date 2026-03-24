const mongoose = require('mongoose');

// A completed weekly mission by a user.
// We store points on the document so leaderboards are fast and consistent.
const missionCompletionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null, index: true },

    weekKey: { type: String, required: true, trim: true, index: true }, // e.g. "2026-W13"
    missionKey: { type: String, required: true, trim: true, index: true }, // e.g. "call_friend"
    points: { type: Number, default: 5, min: 0, max: 500 },

    completedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

missionCompletionSchema.index({ user: 1, weekKey: 1, missionKey: 1 }, { unique: true });
missionCompletionSchema.index({ weekKey: 1, school: 1, points: -1, createdAt: -1 });

module.exports = mongoose.model('MissionCompletion', missionCompletionSchema);

