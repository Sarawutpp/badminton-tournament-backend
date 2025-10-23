const mongoose = require('mongoose');
const Team = require('../models/team.model');
const Match = require('../models/match.model');
const Tournament = require('../models/tournament.model');

function buildRoundRobinPairs(teamIds) {
  const pairs = [];
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      pairs.push([teamIds[i], teamIds[j]]);
    }
  }
  return pairs;
}

exports.manualGroupAndGenerate = async ({ tournamentId, tournamentName, handLevel, groups }) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // 1) หา/สร้าง tournament
    let tournamentDoc = null;
    if (tournamentId) {
      tournamentDoc = await Tournament.findById(tournamentId).session(session);
      if (!tournamentDoc) {
        const e = new Error('ไม่พบ tournamentId ที่ส่งมา');
        e.status = 400;
        throw e;
      }
    } else {
      const created = await Tournament.create(
        [{ name: tournamentName || `Tournament - ${handLevel}`, handLevel, phase: 'group' }],
        { session }
      );
      tournamentDoc = created[0];
    }

    // 2) ตรวจทีมทั้งหมดใน payload
    const allIds = Object.values(groups).flat();
    const teams = await Team.find({ _id: { $in: allIds } }).session(session);
    if (teams.length !== allIds.length) {
      const e = new Error('มี teamId ที่ไม่ถูกต้องใน groups');
      e.status = 400;
      throw e;
    }
    const wrongHand = teams.filter(t => t.handLevel !== handLevel);
    if (wrongHand.length) {
      const e = new Error('พบทีมที่ handLevel ไม่ตรงกับที่เลือก');
      e.status = 400;
      throw e;
    }

    // 3) อัปเดต group ให้ทีมตามกลุ่ม
    const bulk = [];
    for (const [gname, ids] of Object.entries(groups)) {
      if (!Array.isArray(ids)) continue;
      for (const id of ids) {
        bulk.push({
          updateOne: { filter: { _id: id }, update: { $set: { group: gname } } }
        });
      }
    }
    if (bulk.length) await Team.bulkWrite(bulk, { session });

    // เคลียร์ group ของทีมในมือเดียวกันที่ไม่อยู่ใน payload (กลับเป็น null)
    await Team.updateMany(
      { handLevel, _id: { $nin: allIds } },
      { $set: { group: null } },
      { session }
    );

    // 4) ลบแมตช์รอบแบ่งกลุ่มเดิมของทัวร์นี้ แล้วสร้างใหม่แบบ round-robin
    await Match.deleteMany({
      tournamentId: String(tournamentDoc._id),
      round: { $regex: /^Group\s/i }
    }).session(session);

    let createdCount = 0;
    const createOps = [];

    for (const [gname, ids] of Object.entries(groups)) {
      if (!ids || ids.length < 2) continue; // กลุ่มที่น้อยกว่า 2 ทีม ไม่สร้างแมตช์
      const pairs = buildRoundRobinPairs(ids);
      for (const [t1, t2] of pairs) {
        createOps.push({
          tournamentId: String(tournamentDoc._id),
          round: `Group ${gname}`,
          team1: t1,
          team2: t2,
          status: 'pending'
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
      tournamentId: String(tournamentDoc._id),
      handLevel,
      groups,
      createdMatches: createdCount
    };
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    throw e;
  }
};
