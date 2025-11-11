// routes/tournament.routes.js  (เวอร์ชันปรับปรุง)
const router = require('express').Router();
const mongoose = require('mongoose');
const Match = require("../models/match.model");
const Team  = require("../models/team.model");
const TournamentService = require('../services/tournament.service');

// ----------------- helpers -----------------
function normalizeHand(input = '') {
  return String(input)
    .replace(/\(.*?\)/g, '')     // ตัดวงเล็บท้ายชื่อมือ
    .replace(/^เดี่ยว\s+/, '')   // ตัดคำว่า "เดี่ยว "
    .trim()
    .toUpperCase();
}

function groupLetterFromName(name = '') {
  const s = String(name).trim();
  const mm = s.match(/Group\s+([A-Z])/i);
  return mm ? mm[1].toUpperCase() : s.slice(-1).toUpperCase();
}

function pad(n, size = 2) { return String(n).padStart(size, '0'); }

// เดาจำนวนทีมจากคู่ KO เพื่อตั้ง koCode อัตโนมัติ เมื่อไม่ส่งมา
function inferKoCodeByPairs(countMatches) {
  const teams = countMatches * 2;
  if (teams === 16) return 'KO16';
  if (teams === 8)  return 'QF';
  if (teams === 4)  return 'SF';
  if (teams === 2)  return 'F';
  return `KO${teams}`;
}

// ----------------- GROUPS -----------------

/**
 * Manual groups + Round Robin (เป็น "รอบ")
 * body ตัวอย่างที่รองรับ:
 * {
 *   tournamentId: "default",
 *   handLevel: "BABY",
 *   groups: { "A": ["teamId1","teamId2",...], "B": [...] }
 * }
 */
router.post('/generate-groups/manual', async (req, res, next) => {
  try {
    const result = await TournamentService.manualGroupAndGenerate(req.body);
    return res.status(201).json(result);
  } catch (err) { next(err); }
});

/**
 * Auto groups + RR:
 * - กรณีส่ง groupNames มา (เช่น ["Group A","Group B","Group C"]) จะกระจายทีมลงแต่ละกลุ่มให้เท่าๆ กัน
 *   แล้วเรียก manualGroupAndGenerate เพื่อให้ได้ฟอร์แมต matchId/groupRound ตามมาตรฐานเดียวกัน
 * - กรณีไม่ส่ง groupNames ให้ใช้ teamsPerGroup + generateMatches("RR") เป็นทางลัด
 */
router.post('/generate-groups', async (req, res, next) => {
  try {
    const {
      handLevel,
      tournamentId = 'default',
      groupNames,          // เช่น ["Group A","Group B"]
      teamsPerGroup = 4,   // ใช้เมื่อไม่ส่ง groupNames
    } = req.body || {};

    const level = normalizeHand(handLevel);
    if (!level) throw new Error("handLevel is required for auto-generation");

    const allTeams = await Team.find({ handLevel: level }).select('_id teamName').lean();
    if (!allTeams.length) return res.status(400).json({ message: 'No teams to group' });

    // มีรายชื่อกลุ่มมา -> จัดกลุ่มแบบเท่าๆ กัน แล้วส่งเข้า manualGroupAndGenerate
    if (Array.isArray(groupNames) && groupNames.length) {
      const shuffled = allTeams.slice().sort(() => Math.random() - 0.5);
      const buckets = groupNames.map((name) => ({
        name,
        letter: groupLetterFromName(name),
        teamIds: []
      }));
      shuffled.forEach((t, i) => buckets[i % buckets.length].teamIds.push(t._id));

      const payload = {
        tournamentId,
        handLevel: level,
        groups: buckets.map(b => ({ letter: b.letter, teamIds: b.teamIds }))
      };
      const result = await TournamentService.manualGroupAndGenerate(payload);
      return res.status(201).json({
        ...result,
        groups: buckets.map(b => ({ name: b.name, teamCount: b.teamIds.length }))
      });
    }

    // ไม่กำหนด groupNames -> ใช้ teamsPerGroup + strategy RR
    const result = await TournamentService.generateMatches(level, 'RR', teamsPerGroup);
    return res.status(201).json(result);
  } catch (err) { next(err); }
});

// ----------------- KNOCKOUT -----------------

/**
 * Manual KO:
 * body ตัวอย่าง:
 * {
 *   tournamentId: "default",
 *   handLevel: "BABY",
 *   koCode: "KO16" | "QF" | "SF" | "F",
 *   pairs: [ { t1: "<ObjectId>", t2: "<ObjectId>" }, ... ]   // เรียงลำดับไว้แล้ว
 * }
 */
router.post('/generate-knockout/manual', async (req, res, next) => {
  try {
    const {
      tournamentId = 'default',
      handLevel,
      koCode,
      pairs = [],
      gamesToWin = 2
    } = req.body || {};

    const level = normalizeHand(handLevel);
    if (!level) throw new Error('handLevel is required');
    if (!Array.isArray(pairs) || pairs.length === 0) throw new Error('pairs is required (non-empty)');

    const roundCode = koCode || inferKoCodeByPairs(pairs.length);

    const result = await TournamentService.generateKnockout({
      tournamentId,
      handLevel: level,
      koCode: roundCode,
      pairs,
      gamesToWin
    });

    return res.status(201).json({ ...result, koCode: roundCode });
  } catch (err) { next(err); }
});

/**
 * Auto KO (Top2 per group, ประกบ A1-B2, B1-A2, ... ทีละคู่ของกลุ่ม):
 * body ตัวอย่าง:
 * {
 *   tournamentId: "default",
 *   handLevel: "BABY",
 *   groupLetters: ["A","B","C","D"],     // ต้องเรียงลำดับตามสาย
 *   gamesToWin: 2,
 *   koCode: "QF"                          // ถ้าไม่ส่ง จะเดาตามจำนวนคู่
 * }
 */
router.post('/generate-knockout/auto', async (req, res, next) => {
  try {
    const {
      tournamentId = 'default',
      handLevel,
      groupLetters = ['A','B'],
      gamesToWin = 2,
      koCode
    } = req.body || {};

    const level = normalizeHand(handLevel);
    if (!level) throw new Error('handLevel is required');
    if (!Array.isArray(groupLetters) || groupLetters.length < 2) {
      throw new Error('groupLetters is required (>=2)');
    }

    // ดึงอันดับกลุ่ม (Top 2) ของแต่ละตัวอักษร
    const byGroup = {};
    for (const L of groupLetters) {
      const top2 = await Team.find({
        group: L, handLevel: { $regex: new RegExp(`^${level}$`, 'i') }
      })
        .sort({ points: -1, scoreDifference: -1, wins: -1, scoreFor: -1 })
        .limit(2)
        .select('_id teamName group handLevel points scoreDifference wins scoreFor')
        .lean();

      byGroup[L] = top2;
    }

    // ประกบคู่ A1-B2, B1-A2 | C1-D2, D1-C2 | ...
    const pairs = [];
    for (let i = 0; i < groupLetters.length; i += 2) {
      const G1 = groupLetters[i], G2 = groupLetters[i + 1];
      if (!G2) break;
      const [G1_1, G1_2] = byGroup[G1] || [];
      const [G2_1, G2_2] = byGroup[G2] || [];
      if (G1_1 && G2_2) pairs.push({ t1: G1_1._id, t2: G2_2._id });
      if (G2_1 && G1_2) pairs.push({ t1: G2_1._id, t2: G1_2._id });
    }

    if (!pairs.length) return res.status(400).json({ message: 'No pairs generated (check groups/standings)' });

    const roundCode = koCode || inferKoCodeByPairs(pairs.length);

    const result = await TournamentService.generateKnockout({
      tournamentId,
      handLevel: level,
      koCode: roundCode,
      pairs,
      gamesToWin
    });

    return res.status(201).json({ ...result, koCode: roundCode, pairs: pairs.length });
  } catch (err) { next(err); }
});

// ----------------- STANDINGS / OVERVIEW -----------------

router.get('/standings', async (req, res, next) => {
  try {
    const { handLevel } = req.query;
    const level = handLevel ? String(handLevel).toUpperCase() : undefined;

    const teams = await Team.find(level ? { handLevel: level } : {}).populate('players').lean();

    const byLevel = {};
    for (const t of teams) {
      const L = t.handLevel || 'UNKNOWN';
      if (!byLevel[L]) byLevel[L] = {};
      if (!t.group) continue;
      if (!byLevel[L][t.group]) byLevel[L][t.group] = [];
      byLevel[L][t.group].push(t);
    }

    const result = Object.entries(byLevel)
      .map(([levelName, groups]) => {
        const items = Object.entries(groups)
          .map(([groupName, ts]) => {
            ts.sort((a, b) =>
              (b.points ?? 0) - (a.points ?? 0) ||
              (b.scoreDiff ?? 0) - (a.scoreDiff ?? 0) ||
              (b.wins ?? 0) - (a.wins ?? 0) ||
              (b.scoreFor ?? 0) - (a.scoreFor ?? 0)
            );
            return { groupName, teams: ts };
          })
          .sort((a, b) => a.groupName.localeCompare(b.groupName));
        return { level: levelName, groups: items };
      })
      .sort((a, b) => a.level.localeCompare(b.level));

    return res.json(result);
  } catch (err) { next(err); }
});

router.get('/overview', async (_req, res, next) => {
  try {
    const [teamCount, matchCount] = await Promise.all([
      Team.countDocuments(),
      Match.countDocuments(),
    ]);
    return res.json({ teamCount, matchCount });
  } catch (err) { next(err); }
});

module.exports = router;
