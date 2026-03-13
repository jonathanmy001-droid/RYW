const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatGroup', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    text: { type: String, required: true, trim: true, maxlength: 4000 },

    // For future: attachments, reactions, pinned, etc.
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true }
);

chatMessageSchema.index({ group: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);

