// backend/src/services/tournament.service.js
const mongoose = require('mongoose');
const Team = require('../models/team.model');
const Match = require('../models/match.model');

// ให้ round-robin เป็นคู่พบกันหมด
function buildRoundRobinPairs(teamIds) {
  const pairs = [];
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      pairs.push([teamIds[i], teamIds[j]]);
    }
  }
  return pairs;
}

// ทำรูปแบบชื่อระดับมือให้สม่ำเสมอ
function normalizeHand(input = '') {
  return String(input)
    .replace(/\(.*?\)/g, '')   // ตัด text ในวงเล็บ
    .replace(/^เดี่ยว\s+/, '') // ตัด "เดี่ยว "
    .trim()
    .toUpperCase();
}

exports.manualGroupAndGenerate = async ({ tournamentId, handLevel, groups }) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // ---- เตรียมค่าใช้งาน ----
    const handNorm = normalizeHand(handLevel || '');
    // อนุญาตให้ใช้ tournamentId เป็นสตริงทั่วไปได้ (ไม่ต้องเป็น ObjectId)
    const tournamentIdToUse = (tournamentId && String(tournamentId)) || 'default';

    // ---- ตรวจสอบทีมที่ส่งมา ----
    const allIds = Object.values(groups || {}).flat();
    const teams = await Team.find({ _id: { $in: allIds } }).session(session);

    // ถ้า handLevel ไม่ตรง แค่ "เตือน" แต่ไม่ทำให้ล้มทั้งงาน
    const mismatch = teams.filter(t => normalizeHand(t.handLevel) !== handNorm);
    if (mismatch.length) {
      console.warn('[manualGroupAndGenerate] handLevel mismatch:', {
        expected: handNorm, got: mismatch.map(t => t.handLevel)
      });
      // ถ้าอยาก “บังคับให้ตรงแล้วค่อยไปต่อ” ให้โยน error ตรงนี้แทน
      // const e = new Error('พบทีมที่ handLevel ไม่ตรงกับที่เลือก');
      // e.status = 400; throw e;
    }

    // ---- อัปเดต group ให้ทีมตาม payload ----
    const bulk = [];
    for (const [gname, ids] of Object.entries(groups || {})) {
      if (!Array.isArray(ids)) continue;
      for (const id of ids) {
        bulk.push({
          updateOne: {
            filter: { _id: id },
            update: { $set: { group: gname } },
          },
        });
      }
    }
    if (bulk.length) await Team.bulkWrite(bulk, { session });

    // ทีมในระดับมือนี้ที่ไม่ได้อยู่ใน groups ให้เคลียร์ group ออก (กันค้าง)
    if (handNorm) {
      await Team.updateMany(
        { handLevel: new RegExp(`^${handNorm}$`, 'i'), _id: { $nin: allIds } },
        { $set: { group: null } },
        { session }
      );
    }

    // ---- ลบแมตช์รอบแบ่งกลุ่มเก่าในทัวร์นาเมนต์นี้ก่อน ----
    await Match.deleteMany({
      tournamentId: tournamentIdToUse,
      round: { $regex: /^Group\s/i },
    }).session(session);

    // ---- สร้างแมตช์พบกันหมดใหม่ ----
    let createdCount = 0;
    const createOps = [];
    for (const [gname, ids] of Object.entries(groups || {})) {
      if (!ids || ids.length < 2) continue;
      const pairs = buildRoundRobinPairs(ids);
      for (const [t1, t2] of pairs) {
        createOps.push({
          tournamentId: tournamentIdToUse,
          round: `Group ${gname}`,
          team1: t1,
          team2: t2,
          status: 'pending',
        });
      }
    }
    if (createOps.length) {
      await Match.insertMany(createOps, { session });
      createdCount = createOps.length;
    }

    await session.commitTransaction();
    session.endSession();

    return {
      ok: true,
      tournamentId: tournamentIdToUse,
      handLevel: handNorm,
      groups,
      createdMatches: createdCount,
      warning: mismatch.length ? 'handLevel ของบางทีมไม่ตรง แต่ดำเนินการต่อ' : undefined,
    };
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    // ส่งสถานะ 400 ถ้าไม่กำหนดไว้เพื่อให้หน้าเว็บแจ้งเตือนสวย ๆ
    e.status = e.status || 400;
    throw e;
  }
};
