const router = require('express').Router();
const Team = require('../models/team.model');
const Match = require('../models/match.model');
const { manualGroupAndGenerate } = require('../services/tournament.service');

// ---- NEW: Manual grouping + create round-robin matches ----
router.post('/generate-groups/manual', async (req, res, next) => {
  try {
    const { handLevel, groups = {}, tournamentId = 'default' } = req.body;
    if (!handLevel || !groups || typeof groups !== 'object') {
      return res.status(400).json({ message: 'handLevel และ groups จำเป็น' });
    }

    // ตรวจสอบทีมที่ถูกส่งมาทั้งหมด
    const allIds = Object.values(groups).flat();
    const teams = await Team.find({ _id: { $in: allIds } });
    if (teams.length !== allIds.length) {
      return res.status(400).json({ message: 'พบ teamId ไม่ถูกต้องใน groups' });
    }

    // อัปเดต group บน Team (ตั้งค่าเป็นตัวอักษร A/B/C เท่านั้น)
    for (const [letter, ids] of Object.entries(groups)) {
      if (!Array.isArray(ids)) continue;
      await Team.updateMany({ _id: { $in: ids } }, { $set: { group: letter } });
    }
    // (ทางเลือก) เคลียร์ group ของทีมมือเดียวกันที่ไม่อยู่ใน payload
    await Team.updateMany(
      { handLevel, _id: { $nin: allIds } },
      { $set: { group: null } }
    );

    // ลบแมตช์ Group เดิมของทัวร์นี้ (กันซ้ำ) แล้วสร้างใหม่
    await Match.deleteMany({ tournamentId, round: { $regex: /^Group\s/i } });

    let created = 0;
    for (const [letter, ids] of Object.entries(groups)) {
      if (!ids || ids.length < 2) continue; // กลุ่ม < 2 ทีม ไม่ต้องสร้าง
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          await Match.create({
            tournamentId,
            round: `Group ${letter}`,
            team1: ids[i],
            team2: ids[j],
            status: 'pending'
          });
          created++;
        }
      }
    }

    return res.status(201).json({ ok: true, createdMatches: created, groups: Object.keys(groups) });
  } catch (err) {
    next(err);
  }
});

// ---- Keep: Random grouping (เดิม) ----
router.post('/generate-groups', async (req, res, next) => {
  try {
    const { handLevel, groupNames = ['Group A','Group B'], tournamentId = 'default' } = req.body;
    const teams = await Team.find(handLevel ? { handLevel } : {});
    if (!teams.length) return res.status(400).json({ message: 'No teams to group' });

    // shuffle
    const arr = teams.sort(() => Math.random() - 0.5);
    const groups = groupNames.map(name => ({ name, teams: [] }));
    // round-robin assignment
    arr.forEach((t, i) => groups[i % groups.length].teams.push(t));

    // save group letter on team and create round-robin matches per group
    const createdMatches = [];
    for (const g of groups) {
      const groupLetter = g.name.split(' ').pop(); // e.g., 'A'
      for (const t of g.teams) {
        t.group = groupLetter;
        await t.save();
      }
      // round robin matches: every pair meets once
      for (let i = 0; i < g.teams.length; i++) {
        for (let j = i + 1; j < g.teams.length; j++) {
          const m = await Match.create({
            tournamentId,
            round: `Group ${groupLetter}`,
            team1: g.teams[i]._id,
            team2: g.teams[j]._id,
            status: 'pending'
          });
          createdMatches.push(m);
        }
      }
    }

    res.status(201).json({
      groups: groups.map(g => ({ name: g.name, teamCount: g.teams.length })),
      matches: createdMatches.length
    });
  } catch (err) {
    next(err);
  }
});

// ---- Keep: Knockout (เดิม: เอาอันดับ 1-2 ของแต่ละกลุ่มไปจับคู่) ----
router.post('/generate-knockout', async (req, res, next) => {
  try {
    const { groupLetters = ['A','B'], tournamentId = 'default' } = req.body;
    const byGroup = {};
    for (const letter of groupLetters) {
      const teams = await Team
        .find({ group: letter })
        .sort({ points: -1, scoreDifference: -1 })
        .limit(2);
      byGroup[letter] = teams;
    }

    // Pairing: A1 vs B2, B1 vs A2 (ต่อยอดเพิ่ม C/D ได้ภายหลัง)
    const pairs = [];
    if (byGroup['A']?.[0] && byGroup['B']?.[1]) pairs.push([byGroup['A'][0], byGroup['B'][1]]);
    if (byGroup['B']?.[0] && byGroup['A']?.[1]) pairs.push([byGroup['B'][0], byGroup['A'][1]]);

    const created = [];
    for (const [t1, t2] of pairs) {
      const m = await Match.create({
        tournamentId,
        round: 'Quarter-final',
        team1: t1?._id,
        team2: t2?._id,
        status: 'pending'
      });
      created.push(m);
    }
    res.status(201).json({ created: created.length });
  } catch (err) {
    next(err);
  }
});

// ---- Overview (เดิม) ----
router.get('/overview', async (_req, res, next) => {
  try {
    const [teamCount, matchCount] = await Promise.all([
      require('../models/team.model').countDocuments(),
      require('../models/match.model').countDocuments()
    ]);
    res.json({ teamCount, matchCount });
  } catch (err) {
    next(err);
  }
});
router.post('/generate-groups/manual', async (req, res, next) => {
  try {
    const result = await manualGroupAndGenerate(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
