// src/utils/sequence.util.js
const Counter = require('../models/counter.model');

/**
 * ดึงเลขลำดับถัดไปแบบ atomic (ยังคงใช้ฟิลด์ `key`)
 * ตัวอย่าง: await getNextSequence('TEAM_BG-')
 */
async function getNextSequence(name) {
  const doc = await Counter.findOneAndUpdate(
    { key: name },
    { $inc: { seq: 1 }, $setOnInsert: { key: name, seq: 0 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, projection: { seq: 1 } }
  ).lean();
  return doc.seq;
}

function pad(n, width = 3) {
  const s = String(n);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

/** สร้างรหัสรันนิ่ง เช่น buildRunningCode('TEAM_BG-', 3) -> 'TEAM_BG-007' */
async function buildRunningCode(prefix, width = 3) {
  const n = await getNextSequence(prefix);
  return `${prefix}${pad(n, width)}`;
}

module.exports = { getNextSequence, pad, buildRunningCode };
