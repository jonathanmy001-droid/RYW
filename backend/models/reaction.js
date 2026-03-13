const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    targetType: { type: String, required: true, trim: true, index: true }, // e.g. 'worship'
    targetKey: { type: String, required: true, trim: true, index: true }, // e.g. 'live-featured'
    kind: { type: String, enum: ['amen', 'glory'], required: true, index: true },
  },
  { timestamps: true }
);

reactionSchema.index({ user: 1, targetType: 1, targetKey: 1, kind: 1 }, { unique: true });
reactionSchema.index({ targetType: 1, targetKey: 1, kind: 1 });

module.exports = mongoose.model('Reaction', reactionSchema);

