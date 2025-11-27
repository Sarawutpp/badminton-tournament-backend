// models/team.model.js

const mongoose = require("mongoose");

const { Schema } = mongoose;

const teamSchema = new Schema(
  {
    tournamentId: {
      type: String,
      required: true,
      default: "default",
      index: true,
      set: (value) => (value ? String(value) : "default"),
      trim: true,
    },

    handLevel: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    group: {
      type: String,
      trim: true,
    },

    groupOrder: {
      type: Number,
      default: 0,
    },

    teamName: {
      type: String,
      required: true,
      trim: true,
    },

    seedNo: {
      type: Number,
      default: 0,
    },

    // ✅ เพิ่ม field manualRank ตรงนี้ครับ
    manualRank: {
      type: Number,
      default: 0,
    },

    players: [
      {
        type: Schema.Types.ObjectId,
        ref: "Player",
        required: true,
      },
    ],

    note: {
      type: String,
      trim: true,
    },

    // ---------- สถิติการแข่งขันรวม (ใช้สำหรับ Standings) ----------
    matchesPlayed: {
      type: Number,
      default: 0,
    },

    wins: {
      type: Number,
      default: 0,
    },

    draws: {
      type: Number,
      default: 0,
    },

    losses: {
      type: Number,
      default: 0,
    },

    // คะแนนสะสม (Win = 3, Draw = 1, Loss/Bye = 0)
    points: {
      type: Number,
      default: 0,
    },

    // แต้มรวม (คะแนน rally point)
    scoreFor: {
      type: Number,
      default: 0,
    },

    scoreAgainst: {
      type: Number,
      default: 0,
    },

    scoreDiff: {
      type: Number,
      default: 0,
    },

    // ---------- สถิติเซ็ต (ใหม่) ----------
    // จำนวนเซ็ตที่ทีมนี้ชนะทั้งหมด
    setsFor: {
      type: Number,
      default: 0,
    },

    // จำนวนเซ็ตที่ทีมนี้แพ้ทั้งหมด
    setsAgainst: {
      type: Number,
      default: 0,
    },

    // ผลต่างเซ็ต = เซ็ตได้ - เซ็ตเสีย
    setsDiff: {
      type: Number,
      default: 0,
    },

    // [เพิ่มใหม่] เก็บผลสกอร์แต่ละแมตช์เป็น String เช่น ["2-0", "1-2"]
    matchScores: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

teamSchema.index({
  tournamentId: 1,
  handLevel: 1,
  group: 1,
  groupOrder: 1,
});

teamSchema.index({
  tournamentId: 1,
  handLevel: 1,
  teamName: 1,
});

module.exports = mongoose.model("Team", teamSchema);