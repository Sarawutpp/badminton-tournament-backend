const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Counter collection สำหรับเก็บเลขรันนิ่งแบบ atomic
 * key ตัวอย่าง: 'PLAYER', 'TEAM_N', 'TEAM_NB'
 */
const counterSchema = new Schema(
  {
    _id: { type: String, required: true }, // ชื่อ sequence
    seq: { type: Number, default: 0 },
  },
  { versionKey: false }
);

module.exports = mongoose.model('Counter', counterSchema);
