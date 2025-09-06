const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const playerSchema = new Schema({
  fullName: { type: String, required: true },
  nickname: { type: String },
  birthYear: { type: Number },
  shirtSize: { type: String, enum: ['S', 'M', 'L', 'XL', '2XL', '3XL'], default: 'M' },
  lastCompetition: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Player', playerSchema);
