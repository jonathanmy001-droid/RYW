const mongoose = require('mongoose');

const chatGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: '', trim: true, maxlength: 400 },

    // School scoping:
    // - school groups: school=<SchoolId>
    // - national groups: school=null (super_admin only)
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },

    visibility: { type: String, enum: ['school_only', 'national'], default: 'school_only' },
    joinPolicy: { type: String, enum: ['invite_only', 'request_to_join', 'open'], default: 'invite_only' },
    isDiscoverable: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true }
);

chatGroupSchema.index({ school: 1, createdAt: -1 });
chatGroupSchema.index({ visibility: 1, createdAt: -1 });

module.exports = mongoose.model('ChatGroup', chatGroupSchema);

