const router = require('express').Router();
const Team = require('../models/team.model');
const Match = require('../models/match.model');
const { manualGroupAndGenerate } = require('../services/tournament.service');

// ---- helper: ทำให้ชื่อมือเป็นรูปแบบมาตรฐาน (ให้ค้นง่าย) ----
function normalizeHand(input = '') {
  return String(input)
    .replace(/\(.*?\)/g, '')   // ตัด "(...)" เช่น "N (16 ทีม)" -> "N"
    .replace(/^เดี่ยว\s+/, '') // ตัดคำว่า "เดี่ยว "
    .trim()
    .toUpperCase();            // ตัวพิมพ์ใหญ่
}

/**
 * ----------------------------------------------------------------
 * 1) จัดกลุ่มแบบ Manual + สร้างแมตช์พบกันหมด (ใช้กับหน้า Generator)
 * ----------------------------------------------------------------
 * body:
 * {
 *   "tournamentId": "default",          // optional
 *   "tournamentName": "Moodeng Cup",    // optional
 *   "handLevel": "N",
 *   "groups": { "A": ["teamId1","teamId2"], "B": ["teamId3","teamId4"] }
 * }
 */
router.post('/generate-groups/manual', async (req, res, next) => {
  try {
    const result = await manualGroupAndGenerate(req.body);
    return res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * ------------------------------------------------------
 * 2) สุ่มจัดกลุ่มอัตโนมัติ (เผื่ออยากทำปุ่ม Auto Group)
 * ------------------------------------------------------
 * body:
 * {
 *   "handLevel": "N",
 *   "groupNames": ["Group A","Group B","Group C","Group D"],
 *   "tournamentId": "default"
 * }
 */
router.post('/generate-groups', async (req, res, next) => {
  try {
    const {
      handLevel,
      groupNames = ['Group A', 'Group B'],
      tournamentId = 'default',
    } = req.body;

    const level = handLevel ? normalizeHand(handLevel) : undefined;
    const teams = await Team.find(level ? { handLevel: level } : {});
    if (!teams.length) {
      return res.status(400).json({ message: 'No teams to group' });
    }

    // สุ่มแล้วกระจายลงกลุ่ม (round-robin assignment)
    const arr = teams.sort(() => Math.random() - 0.5);
    const groups = groupNames.map((name) => ({ name, teams: [] }));
    arr.forEach((t, i) => groups[i % groups.length].teams.push(t));

    // เซ็ต group ให้ทีม + สร้างแมตช์พบกันหมดให้แต่ละกลุ่ม
    let created = 0;
    for (const g of groups) {
      const groupLetter = g.name.split(' ').pop(); // 'A','B',...
      for (const t of g.teams) {
        t.group = groupLetter;
        await t.save();
      }
      for (let i = 0; i < g.teams.length; i++) {
        for (let j = i + 1; j < g.teams.length; j++) {
          await Match.create({
            tournamentId,
            round: `Group ${groupLetter}`,
            team1: g.teams[i]._id,
            team2: g.teams[j]._id,
            status: 'pending',
          });
          created++;
        }
      }
    }

    return res.status(201).json({
      groups: groups.map((g) => ({ name: g.name, teamCount: g.teams.length })),
      matches: created,
    });
  } catch (err) { next(err); }
});

/**
 * --------------------------------------------------------------
 * 3) สร้างสาย Knockout จากอันดับกลุ่ม (A1 v B2, B1 v A2, ...)
 * --------------------------------------------------------------
 * body: { "groupLetters": ["A","B","C","D"], "tournamentId": "default" }
 */
router.post('/generate-knockout', async (req, res, next) => {
  try {
    const { groupLetters = ['A', 'B'], tournamentId = 'default' } = req.body;

    // ดึงอันดับ 1-2 ของแต่ละกลุ่ม (เรียงตามคะแนน/ผลต่าง/ชนะ)
    const byGroup = {};
    for (const L of groupLetters) {
      const top2 = await Team.find({ group: L })
        .sort({ points: -1, scoreDifference: -1, wins: -1 })
        .limit(2);
      byGroup[L] = top2;
    }

    // ประกบคู่แบบมาตรฐานเป็นคู่ ๆ
    const pairs = [];
    for (let i = 0; i < groupLetters.length; i += 2) {
      const G1 = groupLetters[i];
      const G2 = groupLetters[i + 1];
      if (!G2) break;
      const [A1, A2] = byGroup[G1] || [];
      const [B1, B2] = byGroup[G2] || [];
      if (A1 && B2) pairs.push([A1._id, B2._id]);
      if (B1 && A2) pairs.push([B1._id, A2._id]);
    }

    // (ออปชัน) ลบสาย KO เดิมก่อน
    await Match.deleteMany({
      tournamentId,
      round: { $in: ['Round of 16', 'Quarter-final', 'Semifinal', 'Final'] },
    });

    let created = 0;
    for (const [t1, t2] of pairs) {
      await Match.create({
        tournamentId,
        round: 'Quarter-final',  // ปรับระดับรอบตามจำนวนคู่ได้
        team1: t1,
        team2: t2,
        status: 'pending',
      });
      created++;
    }

    return res.status(201).json({ created, pairs: pairs.length });
  } catch (err) { next(err); }
});

/**
 * ----------------------------------------------------------------
 * 4) Standings แบบ nested (ดึงไปโชว์หน้า Admin/Standings ได้เลย)
 * ----------------------------------------------------------------
 * query: ?handLevel=N  (ถ้าส่งมาจะกรองเฉพาะมือ)
 */
router.get('/standings', async (req, res, next) => {
  try {
    const { handLevel } = req.query;
    const filter = {};
    if (handLevel) filter.handLevel = normalizeHand(handLevel);

    const teams = await Team.find(filter).populate('players').lean();

    // รวมเป็นรูปแบบ { level: [{ groupName, teams: [...] }, ...], ... }
    const byLevel = {};
    for (const t of teams) {
      const level = t.handLevel || 'UNKNOWN';
      if (!byLevel[level]) byLevel[level] = {};
      if (!t.group) continue; // ยังไม่ถูกจัดกลุ่ม
      if (!byLevel[level][t.group]) byLevel[level][t.group] = [];
      byLevel[level][t.group].push(t);
    }

    const result = Object.entries(byLevel)
      .map(([level, groups]) => {
        const items = Object.entries(groups)
          .map(([groupName, ts]) => {
            ts.sort((a, b) =>
              (b.points ?? 0) - (a.points ?? 0) ||
              (b.scoreDifference ?? 0) - (a.scoreDifference ?? 0) ||
              (b.wins ?? 0) - (a.wins ?? 0)
            );
            return { groupName, teams: ts };
          })
          .sort((a, b) => a.groupName.localeCompare(b.groupName));
        return { level, groups: items };
      })
      .sort((a, b) => a.level.localeCompare(b.level));

    return res.json(result);
  } catch (err) { next(err); }
});

/**
 * -----------------------------
 * 5) Overview (ไว้หน้า Dashboard)
 * -----------------------------
 */
router.get('/overview', async (_req, res, next) => {
  try {
    const [teamCount, matchCount] = await Promise.all([
      require('../models/team.model').countDocuments(),
      require('../models/match.model').countDocuments(),
    ]);
    res.json({ teamCount, matchCount });
  } catch (err) { next(err); }
});

module.exports = router;
