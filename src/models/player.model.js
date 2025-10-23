const mongoose = require('mongoose');
const { Schema } = mongoose;

const playerSchema = new Schema(
  {
    playerCode: { type: String, unique: true, index: true }, // รหัสผู้เล่นสั้นๆ
    fullName: { type: String, required: true, trim: true },
    nickname: { type: String, trim: true },
    age: { type: Number },            // ถ้าจะคำนวณจาก birthYear ภายหลัง ค่อยเพิ่มฟิลด์ birthYear + hook
    lastCompetition: { type: String },
    photoUrl: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Player', playerSchema);
