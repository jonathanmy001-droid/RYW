const mongoose = require('mongoose');

const activityEventSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null, index: true },
    type: {
      type: String,
      enum: [
        'login',
        'ping',
        'view_event',
        'join_group',
        'send_message',
        'devotion_done',
        'prayer_answered',
        'mentorship_session',
      ],
      required: true,
      index: true,
    },
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

activityEventSchema.index({ school: 1, type: 1, createdAt: -1 });
activityEventSchema.index({ user: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('ActivityEvent', activityEventSchema);

