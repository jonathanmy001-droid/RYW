const mongoose = require('mongoose');

// Logged mentorship sessions (pastor <-> youth), school scoped.
// Notes are private to pastors; youth endpoints must never return privateNotes.
const mentorshipSessionSchema = new mongoose.Schema(
  {
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    youth: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    pastor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    request: { type: mongoose.Schema.Types.ObjectId, ref: 'MentorshipRequest', default: null, index: true },

    occurredAt: { type: Date, default: () => new Date(), index: true },
    durationMinutes: { type: Number, default: 30, min: 5, max: 240 },

    tags: [{ type: String, trim: true, maxlength: 40 }],

    // Pastor-only notes.
    privateNotes: { type: String, default: '', trim: true, maxlength: 5000 },
  },
  { timestamps: true }
);

mentorshipSessionSchema.index({ school: 1, occurredAt: -1 });
mentorshipSessionSchema.index({ youth: 1, occurredAt: -1 });

module.exports = mongoose.model('MentorshipSession', mentorshipSessionSchema);

