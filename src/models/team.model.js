const mongoose = require("mongoose");

const teamSchema = new mongoose.Schema(
  {
    tournamentId: { type: String, default: "default" },
    teamCode: { type: String },
    teamName: { type: String, required: true },
    competitionType: { type: String, default: "doubles" },
    handLevel: { type: String, required: true },
    group: { type: String },

    // อ้างอิง Player ให้ populate ได้จริง
    players: [{ type: mongoose.Schema.Types.ObjectId, ref: "Player" }],

    // สถิติรอบแบ่งกลุ่ม
    matchesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    scoreFor: { type: Number, default: 0 },
    scoreAgainst: { type: Number, default: 0 },
    scoreDiff: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Team", teamSchema);
