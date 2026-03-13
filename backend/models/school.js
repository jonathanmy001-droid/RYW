// backend/models/school.js
const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema({
  name:          { type: String, required: true, unique: true },
  province:      { type: String, required: true },
  code:          { type: String },                  // ← NO unique: true anymore
  admin:         { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  pastor:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isActive:      { type: Boolean, default: true },
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// IMPORTANT: Use capital 'S' for model name
module.exports = mongoose.model('School', schoolSchema);
