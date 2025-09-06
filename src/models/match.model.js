const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const gameSchema = new Schema({
  game: Number, t1: Number, t2: Number
}, { _id: false });

const matchSchema = new Schema({
  tournamentId: { type: String, required: true },
  round: { type: String, required: true }, // 'Group A', 'R16', 'QF', 'SF', 'Final'
  scheduledAt: { type: Date },
  court: { type: String },
  order: { type: Number },

  team1: { type: Schema.Types.ObjectId, ref: 'Team' },
  team2: { type: Schema.Types.ObjectId, ref: 'Team' },

  score1: { type: Number, default: 0 },
  score2: { type: Number, default: 0 },
  games: [gameSchema],

  winner: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
  status: { type: String, enum: ['pending', 'in-progress', 'finished'], default: 'pending' },

  nextMatchId: { type: Schema.Types.ObjectId, ref: 'Match', default: null }
}, { timestamps: true });

module.exports = mongoose.model('Match', matchSchema);
