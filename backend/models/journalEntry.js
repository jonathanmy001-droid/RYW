const mongoose = require('mongoose');

const journalEntrySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null, index: true },

    promptTitle: { type: String, trim: true, default: '' },
    promptRef: { type: String, trim: true, default: '' }, // e.g. "ABAFILIPI 2:13"
    promptText: { type: String, trim: true, default: '' },

    mood: {
      type: String,
      enum: ['blessed', 'comfort', 'battle', 'neutral'],
      default: 'neutral',
      index: true,
    },

    text: { type: String, required: true, trim: true, maxlength: 5000 },
  },
  { timestamps: true }
);

journalEntrySchema.index({ user: 1, createdAt: -1 });
journalEntrySchema.index({ school: 1, createdAt: -1 });

module.exports = mongoose.model('JournalEntry', journalEntrySchema);

