const mongoose = require("mongoose");

const matchSchema = new mongoose.Schema(
  {
    tournamentId: { type: String, default: "default" },

    // ประเภทของรอบ
    roundType: { type: String, enum: ["group", "knockout"], default: "group" },

    // ระดับมือ/กลุ่ม/ชื่อรอบ
    handLevel: { type: String, required: true },
    group: { type: String },
    round: { type: String },

    // ลำดับและรหัสแมตช์
    matchNo: { type: Number },
    matchId: { type: String, unique: true },

    // ทีม
    team1: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },
    team2: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },

    // กติกาและผล
    gamesToWin: { type: Number, default: 2 },
    allowDraw: { type: Boolean, default: false },
    score1: { type: Number, default: 0 },
    score2: { type: Number, default: 0 },
    sets: [{ t1: { type: Number, default: 0 }, t2: { type: Number, default: 0 } }],
    winner: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },

    // สถานะ/เวลา/คอร์ท
    status: { type: String, enum: ["scheduled", "in-progress", "finished"], default: "scheduled" },
    scheduledAt: { type: Date },
    startedAt: { type: Date },
    court: { type: String },

    // สำหรับ knockout
    nextMatchId: { type: String }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Match", matchSchema);
