const mongoose = require('mongoose');

// Mentorship requests are school-scoped and handled by pastors.
// Youth can create/cancel; pastors can accept/reject/close.
const mentorshipRequestSchema = new mongoose.Schema(
  {
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    youth: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Optional: youth can target a specific pastor; otherwise any pastor in the school can accept.
    pastor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    message: { type: String, default: '', trim: true, maxlength: 1500 },

    status: { type: String, enum: ['pending', 'accepted', 'rejected', 'closed', 'cancelled'], default: 'pending', index: true },

    acceptedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

mentorshipRequestSchema.index({ school: 1, status: 1, createdAt: -1 });
mentorshipRequestSchema.index({ youth: 1, createdAt: -1 });

module.exports = mongoose.model('MentorshipRequest', mentorshipRequestSchema);

