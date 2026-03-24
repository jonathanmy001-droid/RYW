const mongoose = require('mongoose');

// Realtime chat for worship sessions (national room by default).
const liveWorshipMessageSchema = new mongoose.Schema(
  {
    sessionKey: { type: String, required: true, trim: true, index: true }, // e.g. "morning"
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null, index: true },
    text: { type: String, required: true, trim: true, maxlength: 800 },
  },
  { timestamps: true }
);

liveWorshipMessageSchema.index({ sessionKey: 1, createdAt: -1 });

module.exports = mongoose.model('LiveWorshipMessage', liveWorshipMessageSchema);

