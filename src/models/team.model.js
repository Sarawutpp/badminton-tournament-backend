const mongoose = require('mongoose');
const { Schema } = mongoose;

const teamSchema = new Schema(
  {
    // ข้อมูลหลักของทีม
    teamCode: { type: String, unique: true, index: true }, // รหัสทีมสั้นๆ ใช้อ้างอิง/นับคะแนน
    teamName: { type: String, required: true, trim: true }, // 👈 ชื่อทีม (ใหม่)
    competitionType: { type: String, enum: ['Singles', 'Doubles'], required: true },
    handLevel: { type: String, required: true }, // โค้ดมือแบบย่อ เช่น N/NB/Baby/BG-/Mix

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
    points: { type: Number, default: 0 },
    scoreDifference: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Team', teamSchema);
