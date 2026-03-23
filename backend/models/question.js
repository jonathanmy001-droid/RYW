const mongoose = require('mongoose');

// Youth -> Pastor Q&A (school scoped).
// Privacy: only the asker and authorized leaders can see the full question/answer.
const questionSchema = new mongoose.Schema(
  {
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    askedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    text: { type: String, required: true, trim: true, maxlength: 1500 },
    isAnonymous: { type: Boolean, default: false },

    status: { type: String, enum: ['open', 'answered', 'closed'], default: 'open', index: true },

    answer: {
      text: { type: String, default: '', trim: true, maxlength: 3000 },
      answeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      answeredAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

questionSchema.index({ school: 1, status: 1, createdAt: -1 });
questionSchema.index({ askedBy: 1, createdAt: -1 });

module.exports = mongoose.model('Question', questionSchema);

