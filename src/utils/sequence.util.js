const Counter = require('../models/counter.model');

/**
 * ดึงเลขลำดับถัดไปแบบ atomic (upsert + $inc)
 * @param {string} name เช่น 'PLAYER', 'TEAM_N', 'TEAM_NB'
 * @returns {Promise<number>} เลขรันนิ่งล่าสุดหลังเพิ่มแล้ว
 */
async function getNextSequence(name) {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, projection: { seq: 1 } }
  );
  return doc.seq;
}

/** เติมเลข 0 หน้าให้ครบหลัก (เช่น 3 หลัก -> 001) */
function pad(n, width = 3) {
  const s = String(n);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

module.exports = { getNextSequence, pad };
