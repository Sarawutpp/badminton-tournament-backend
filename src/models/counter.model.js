// models/counter.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * ใช้ฟิลด์ `key` เป็นตัวระบุ (เช่น 'TEAM_BG-', 'PLAYER', 'MATCH:default')
 * ให้ตรงกับ index เดิมใน DB เพื่อไม่ต้อง migrate ข้อมูล
 */
const counterSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    seq: { type: Number, default: 0 },
  },
  { collection: 'counters', versionKey: false }
);

// (ออปชัน) helper: Counter.next('TEAM_BG-') -> เลขล่าสุดหลัง +1
counterSchema.statics.next = async function (name) {
  const doc = await this.findOneAndUpdate(
    { key: name },
    { $inc: { seq: 1 }, $setOnInsert: { key: name, seq: 0 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, projection: { seq: 1 } }
  ).lean();
  return doc.seq;
};

module.exports = mongoose.model('Counter', counterSchema);
