// routes/tournament.routes.js
const router = require('express').Router();
const mongoose = require('mongoose');
const Match = require("../models/match.model");
const Team  = require("../models/team.model");
// [เพิ่ม] Import Tournament Model (จำเป็นสำหรับหน้าเลือกงาน)
const Tournament = require("../models/tournament.model"); 
const TournamentService = require('../services/tournament.service');
const { authMiddleware, requireAdmin } = require("./auth.routes");

router.post("/", async (req, res, next) => {
  try {
    const { name, location, dateRange, settings } = req.body;
    
    if (!name) {
        return res.status(400).json({ message: "Tournament name is required" });
    }

    const newTournament = new Tournament({
      name,
      location,
      dateRange,
      settings: {
        maxScore: Number(settings?.maxScore) || 21,
        totalCourts: Number(settings?.totalCourts) || 4,
        categories: settings?.categories || [],
        rallyPoint: true
      },
      status: 'active'
    });

    const saved = await newTournament.save();
    res.status(201).json(saved);
  } catch(e) { next(e); }
});

// GET /api/tournaments (ดึงรายชื่อทั้งหมด)
router.get("/", async (req, res, next) => {
  try {
    // ดึงรายชื่อเรียงตามวันที่สร้างล่าสุด
    const list = await Tournament.find().sort({ createdAt: -1 }); 
    res.json(list);
  } catch(e) { next(e); }
});

// GET /api/tournaments/:id (ดึงรายละเอียดงานเดียว)
router.get("/:id", async (req, res, next) => {
    try {
        const t = await Tournament.findById(req.params.id);
        if(!t) return res.status(404).json({message:"Not Found"});
        res.json(t);
    } catch(e) { next(e); }
});

router.post("/", authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const { name, location, dateRange, settings } = req.body;
    
    if (!name) return res.status(400).json({ message: "Tournament name is required" });

    const newTournament = new Tournament({
      name,
      location,
      dateRange,
      settings: {
        maxScore: Number(settings?.maxScore) || 21,
        totalCourts: Number(settings?.totalCourts) || 4,
        categories: settings?.categories || [],
        rallyPoint: true
      },
      status: 'active'
    });

    const saved = await newTournament.save();
    res.status(201).json(saved);
  } catch(e) { next(e); }
});

// ----------------------------------------------------------------------
// LOGIC เดิม (Helpers & Group Generation)
// ----------------------------------------------------------------------

function normalizeHand(input = '') {
  return String(input).replace(/\(.*?\)/g, '').replace(/^เดี่ยว\s+/, '').trim().toUpperCase();
}

function groupLetterFromName(name = '') {
  const s = String(name).trim();
  const mm = s.match(/Group\s+([A-Z])/i);
  return mm ? mm[1].toUpperCase() : s.slice(-1).toUpperCase();
}

function inferKoCodeByPairs(countMatches) {
  const teams = countMatches * 2;
  if (teams === 16) return 'KO16';
  if (teams === 8)  return 'QF';
  if (teams === 4)  return 'SF';
  if (teams === 2)  return 'F';
  return `KO${teams}`;
}

// สร้างกลุ่มแบบ Manual
router.post('/generate-groups/manual', async (req, res, next) => {
  try {
    // Service จะอ่าน tournamentId จาก body เพื่อไปดึง Config
    const result = await TournamentService.manualGroupAndGenerate(req.body);
    return res.status(201).json(result);
  } catch (err) { next(err); }
});

// สร้างกลุ่มแบบ Auto
router.post('/generate-groups', async (req, res, next) => {
  try {
    const {
      handLevel,
      tournamentId = 'default',
      groupNames,
      teamsPerGroup = 4,
    } = req.body || {};

    const level = normalizeHand(handLevel);
    if (!level) throw new Error("handLevel is required for auto-generation");

    // [Phase 2] Filter Team by Tournament
    const allTeams = await Team.find({ handLevel: level, tournamentId }).select('_id teamName').lean();
    if (!allTeams.length) return res.status(400).json({ message: 'No teams to group' });

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

    return res.status(400).json({ message: "Please provide groupNames" });
  } catch (err) { next(err); }
});

// ดึงตารางคะแนน (Standings)
router.get("/standings", async (req, res, next) => {
  try {
    const { handLevel, tournamentId } = req.query;
    if (!handLevel) return res.status(400).json({ message: "handLevel required" });
    const data = await TournamentService.getStandings(handLevel, tournamentId);
    res.json(data);
  } catch (err) { next(err); }
});

// ดูภาพรวม (Overview)
router.get('/overview', async (req, res, next) => {
  try {
    const { tournamentId } = req.query;
    const filter = tournamentId ? { tournamentId } : {};
    
    const [teamCount, matchCount] = await Promise.all([
      Team.countDocuments(filter),
      Match.countDocuments(filter),
    ]);
    return res.json({ teamCount, matchCount });
  } catch (err) { next(err); }
});

module.exports = router;