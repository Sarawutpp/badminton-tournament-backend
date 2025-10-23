const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ลบ playerSchema เดิมออก เพราะเราจะใช้ ref ไปที่ 'Player' Model โดยตรง

const teamSchema = new Schema(
  {
    // ข้อมูลหลักของทีม
    teamCode: { type: String, unique: true, index: true }, // เช่น N-001, NB-002
    teamName: { type: String, required: true, trim: true },
    competitionType: {
      type: String,
      enum: ['Singles', 'Doubles'],
      required: true,
    },
    handLevel: { type: String, required: true }, // เช่น N, NB, C, BABY...
    group: { type: String, default: null }, // กลุ่ม A/B/C/... (แทน groupName เดิม)

    // สมาชิก
    players: [{ type: Schema.Types.ObjectId, ref: 'Player', required: true }],

    // ช่องทางติดต่อ
    managerName: { type: String },
    phone: { type: String },
    lineId: { type: String },

    // ค่าสถิติ (ไว้สำหรับตารางคะแนน)
    matchesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    points: { type: Number, default: 0 }, // ชนะ=2, แพ้=1
    scoreDifference: { type: Number, default: 0 }, // ได้-เสีย
  },
  { timestamps: true }
);

module.exports = mongoose.model('Team', teamSchema);

