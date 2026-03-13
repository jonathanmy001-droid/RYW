const mongoose = require('mongoose');

const chatMembershipSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatGroup', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    roleInGroup: { type: String, enum: ['owner', 'moderator', 'member'], default: 'member' },
    status: { type: String, enum: ['active', 'pending', 'banned', 'muted'], default: 'active' },

    joinedAt: { type: Date, default: Date.now },
    mutedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

chatMembershipSchema.index({ group: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('ChatMembership', chatMembershipSchema);

