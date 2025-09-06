const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const tournamentSchema = new Schema({
  name: { type: String, required: true },
  location: { type: String },
  dateRange: { type: String },
  levels: [{ type: String }], // ['BGW','BGM','BGX',...]
  rules: {
    pointsWin: { type: Number, default: 2 },
    pointsLose: { type: Number, default: 1 }
  }
}, { timestamps: true });

module.exports = mongoose.model('Tournament', tournamentSchema);
