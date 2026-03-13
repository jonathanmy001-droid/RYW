const mongoose = require('mongoose');

const testimonySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null, index: true },

    text: { type: String, required: true, trim: true, maxlength: 1000 },
    isAnonymous: { type: Boolean, default: false },
  },
  { timestamps: true }
);

testimonySchema.index({ school: 1, createdAt: -1 });
testimonySchema.index({ createdAt: -1 });

module.exports = mongoose.model('Testimony', testimonySchema);

