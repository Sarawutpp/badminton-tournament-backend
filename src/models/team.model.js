// models/team.model.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const teamSchema = new Schema(
  {
    // [CHANGE] เปลี่ยนจาก String เป็น ObjectId Reference
    tournamentId: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
      // เอา set: ... ออก เพราะเราต้องการ ObjectId จริงๆ ไม่ใช่ String "default"
    },

    handLevel: { type: String, required: true, index: true, trim: true },
    group: { type: String, trim: true },
    groupOrder: { type: Number, default: 0 },
    teamName: { type: String, required: true, trim: true },
    seedNo: { type: Number, default: 0 },
    manualRank: { type: Number, default: 0 },

    players: [{ type: Schema.Types.ObjectId, ref: "Player", required: true }],
    note: { type: String, trim: true },

    // Stats fields (เหมือนเดิม)
    matchesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    scoreFor: { type: Number, default: 0 },
    scoreAgainst: { type: Number, default: 0 },
    scoreDiff: { type: Number, default: 0 },
    setsFor: { type: Number, default: 0 },
    setsAgainst: { type: Number, default: 0 },
    setsDiff: { type: Number, default: 0 },
    matchScores: { type: [String], default: [] },
  },
  { timestamps: true }
);

teamSchema.index({ tournamentId: 1, handLevel: 1, group: 1, groupOrder: 1 });
teamSchema.index({ tournamentId: 1, handLevel: 1, teamName: 1 });

module.exports = mongoose.model("Team", teamSchema);