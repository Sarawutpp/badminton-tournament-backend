// models/team.model.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const teamSchema = new Schema(
  {
    tournamentId: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },

    teamCode: {
      type: String,
      required: true,
      unique: true,
    },

    handLevel: { type: String, required: true, index: true, trim: true },
    group: { type: String, trim: true },
    groupOrder: { type: Number, default: 0 },
    teamName: { type: String, required: true, trim: true },
    
    // [NEW] เก็บ URL รูปภาพทีม
    teamPhotoUrl: { type: String, default: "" },

    seedNo: { type: Number, default: 0 },
    manualRank: { type: Number, default: 0 },

    players: [{ type: Schema.Types.ObjectId, ref: "Player", required: true }],
    note: { type: String, trim: true },

    // Stats fields
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
    couponsUsed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

teamSchema.index({ tournamentId: 1, handLevel: 1, group: 1, groupOrder: 1 });
teamSchema.index({ tournamentId: 1, handLevel: 1, teamName: 1 });

module.exports = mongoose.model("Team", teamSchema);