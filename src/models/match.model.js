// models/match.model.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const setSchema = new Schema(
  {
    t1: { type: Number, default: 0 },
    t2: { type: Number, default: 0 },
  },
  { _id: false }
);

const matchSchema = new Schema(
  {
    // [CHANGE] เปลี่ยนจาก String เป็น ObjectId Reference
    tournamentId: {
      type: Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },

    handLevel: { type: String, required: true, index: true },
    group: { type: String, default: null, index: true },
    roundType: {
      type: String,
      enum: ["group", "knockout", "manual"],
      default: "group",
      index: true,
    },
    round: { type: String, default: null, index: true },
    groupRound: { type: Number, default: null },
    bracketSide: { type: String, default: null, trim: true },
    matchNo: { type: Number, default: null, index: true },
    orderIndex: { type: Number, default: 0, index: true },

    // [แก้ไขจุดที่ 1] เอา unique: true ออก (เพื่อให้ชื่อซ้ำได้ถ้าอยู่คนละทัวร์)
    matchId: { type: String, sparse: true },

    court: { type: String, default: null },
    scheduledAt: { type: Date, default: null },

    team1: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    team2: { type: Schema.Types.ObjectId, ref: "Team", default: null },

    isBye: { type: Boolean, default: false },

    // Legacy fields (เก็บไว้ก่อนตามโค้ดเดิม)
    set1Score1: { type: Number, default: 0 },
    set1Score2: { type: Number, default: 0 },
    set2Score1: { type: Number, default: 0 },
    set2Score2: { type: Number, default: 0 },
    set3Score1: { type: Number, default: 0 },
    set3Score2: { type: Number, default: 0 },

    sets: { type: [setSchema], default: [] },
    gamesToWin: { type: Number, default: 2 },
    allowDraw: { type: Boolean, default: false },

    score1: { type: Number, default: 0 },
    score2: { type: Number, default: 0 },

    winner: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    shuttlecockUsed: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["pending", "scheduled", "in-progress", "finished", "cancelled"],
      default: "pending",
      index: true,
    },

    nextMatchId: { type: Schema.Types.ObjectId, ref: "Match", default: null },
    manualRank: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Indexing เดิม (ยังคงใช้ได้ดี)
matchSchema.index({
  tournamentId: 1,
  handLevel: 1,
  roundType: 1,
  group: 1,
  groupRound: 1,
  matchNo: 1,
});
matchSchema.index({
  tournamentId: 1,
  handLevel: 1,
  roundType: 1,
  round: 1,
  bracketSide: 1,
  matchNo: 1,
});
matchSchema.index({
  tournamentId: 1,
  handLevel: 1,
  roundType: 1,
  round: 1,
  matchNo: 1,
});

// [แก้ไขจุดที่ 2] เพิ่ม Index ใหม่: ห้าม matchId ซ้ำ "เฉพาะในทัวร์นาเมนต์เดียวกัน"
matchSchema.index(
  { tournamentId: 1, matchId: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model("Match", matchSchema);
