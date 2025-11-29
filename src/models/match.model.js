// models/match.model.js
const mongoose = require("mongoose");

const { Schema } = mongoose;

// ใช้สำหรับเก็บคะแนนรายเซ็ต
const setSchema = new Schema(
  {
    t1: { type: Number, default: 0 }, // คะแนนทีม 1 ในแต่ละเซ็ต
    t2: { type: Number, default: 0 }, // คะแนนทีม 2 ในแต่ละเซ็ต
  },
  { _id: false }
);

const matchSchema = new Schema(
  {
    tournamentId: {
      type: String,
      default: "default",
      index: true,
    },

    handLevel: {
      type: String,
      required: true,
      index: true,
      // ตัวอย่าง: "BABY", "BG-", "BG", "C", "P"
    },

    group: {
      type: String,
      default: null,
      index: true,
      // กลุ่มรอบแบ่งกลุ่ม เช่น "A", "B", "C"
    },

    roundType: {
      type: String,
      enum: ["group", "knockout"],
      default: "group",
      index: true,
    },

    // รอบย่อย เช่น
    // - group: "R1", "R2", ...
    // - knockout: "KO16", "QF", "SF", "F"
    round: {
      type: String,
      default: null,
      index: true,
    },

    // สำหรับ group stage: นับรอบในกลุ่ม เช่น 1,2,3
    groupRound: {
      type: Number,
      default: null,
    },

    // ✅ สำหรับแบ่ง "สายบน / สายล่าง" ในรอบ Knockout
    // เช่น "TOP" | "BOTTOM" หรือ "สายบน" | "สายล่าง"
    bracketSide: {
      type: String,
      default: null,
      trim: true,
    },

    matchNo: {
      type: Number,
      default: null,
      index: true,
      // running number ภายใน tournamentId + handLevel + roundType + round
    },
    orderIndex: {
      type: Number,
      default: 0, 
      index: true, // ควร index ไว้เพราะใช้ sort ในหน้า AdminSchedulePlan
    },

    // รหัสแมตช์ เช่น:
    // - รอบแบ่งกลุ่ม: BABY-A-R1-M01
    // - รอบ Knockout: BABY-KO16-M01
    matchId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    court: {
      type: String,
      default: null,
    },

    scheduledAt: {
      type: Date,
      default: null,
    },

    team1: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },

    team2: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },

    // สำหรับ BYE (เช่น KO16 มีทีมไม่ครบ)
    isBye: {
      type: Boolean,
      default: false,
    },

    // ---- Legacy fields (เก็บไว้เพื่อ backward compatibility) ----
    set1Score1: { type: Number, default: 0 },
    set1Score2: { type: Number, default: 0 },
    set2Score1: { type: Number, default: 0 },
    set2Score2: { type: Number, default: 0 },
    set3Score1: { type: Number, default: 0 },
    set3Score2: { type: Number, default: 0 },

    // ---- โครงสร้างใหม่: เก็บคะแนนเป็น array ของ set ----
    // เช่น [{ t1:21,t2:18 }, { t1:19,t2:21 }, ...]
    sets: {
      type: [setSchema],
      default: [],
    },

    gamesToWin: {
      type: Number,
      default: 2, // BO3
    },

    // group stage เท่านั้นที่อาจ allowDraw = true
    // knockout จะถูกบังคับเป็น false เสมอในฝั่งคะแนน
    allowDraw: {
      type: Boolean,
      default: false,
    },

    // คะแนนรวม (รวมทุกเซ็ต)
    score1: {
      type: Number,
      default: 0,
    },
    score2: {
      type: Number,
      default: 0,
    },

    // ผู้ชนะ (team1 หรือ team2) หรือ null (กรณีเสมอใน group)
    winner: {
      type: Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },

    status: {
      type: String,
      enum: ["pending", "scheduled", "in-progress", "finished", "cancelled"],
      default: "pending",
      index: true,
    },

    // สำหรับ knockout: ผู้ชนะจะไปเจอในแมตช์ถัดไป
    nextMatchId: {
      type: Schema.Types.ObjectId,
      ref: "Match",
      default: null,
    },
    manualRank: {
      type: Number,
      default: 0, 
    },
  },
  {
    timestamps: true,
  }
);

// ---- Indexes สำหรับ query ที่ใช้บ่อย ----

// Group stage standings / list
matchSchema.index({
  tournamentId: 1,
  handLevel: 1,
  roundType: 1,
  group: 1,
  groupRound: 1,
  matchNo: 1,
});

// Knockout list / bracket ตามรอบ + สายบน/ล่าง + ลำดับแมตช์
matchSchema.index({
  tournamentId: 1,
  handLevel: 1,
  roundType: 1,
  round: 1,
  bracketSide: 1,
  matchNo: 1,
});

// Generic lookup
matchSchema.index({
  tournamentId: 1,
  handLevel: 1,
  roundType: 1,
  round: 1,
  matchNo: 1,
});



module.exports = mongoose.model("Match", matchSchema);
