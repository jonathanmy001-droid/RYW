const mongoose = require('mongoose');

const eventRsvpSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['going', 'interested', 'not_going'], default: 'going' },
  },
  { timestamps: true }
);

eventRsvpSchema.index({ event: 1, user: 1 }, { unique: true });
eventRsvpSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('EventRsvp', eventRsvpSchema);

