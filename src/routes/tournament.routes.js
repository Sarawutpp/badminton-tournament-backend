// routes/tournament.routes.js
const router = require('express').Router();
const mongoose = require('mongoose');
const Match = require("../models/match.model");
const Team  = require("../models/team.model");
const Tournament = require("../models/tournament.model"); 
const TournamentService = require('../services/tournament.service');
const { authMiddleware, requireAdmin } = require("./auth.routes");

// ==========================================
// 🏆 NEW: HALL OF FAME API (PART 1)
// ==========================================
router.get("/:id/hall-of-fame", async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid Tournament ID" });
    }

    // 1. ดึงแมตช์สำคัญ (Final & Semi Final) ที่จบแล้ว
    const matches = await Match.find({
      tournamentId: id,
      status: "finished",
      roundType: "knockout",
      round: { $in: ["F", "Final", "SF", "Semi Final", "CN"] }, 
      winner: { $ne: null }
    })
    .populate({
      path: "winner",
      // ✅ [แก้จุดที่ 1] เพิ่ม teamPhotoUrl เข้าไปใน select
      select: "teamName players teamCode teamPhotoUrl", 
      populate: { path: "players", select: "fullName nickname photoUrl" }
    })
    .populate({
      path: "team1",
      // ✅ [แก้จุดที่ 1] เพิ่ม teamPhotoUrl
      select: "teamName players teamCode teamPhotoUrl",
      populate: { path: "players", select: "fullName nickname photoUrl" }
    })
    .populate({
      path: "team2",
      // ✅ [แก้จุดที่ 1] เพิ่ม teamPhotoUrl
      select: "teamName players teamCode teamPhotoUrl",
      populate: { path: "players", select: "fullName nickname photoUrl" }
    })
    .lean(); 

    const hallOfFame = {};

    const isLowerBracket = (m) => {
      const text = `${m.group || ""} ${m.bracketSide || ""}`.toLowerCase();
      // ✅ เพิ่ม check "bottom" ให้ครอบคลุม
      return text.includes("lower") || text.includes("plate") || text.includes("consolation") || text.includes("bottom");
    };

    // Helper: จัด Format ข้อมูลทีม
    const formatTeam = (team, rank) => {
      if (!team) return null;
      
      // ✅ [แก้จุดที่ 2] เช็ค teamPhotoUrl ของทีมก่อน ถ้าไม่มีค่อยไปเอารูปผู้เล่น
      const photoUrl = team.teamPhotoUrl || team.players?.[0]?.photoUrl || null; 
      
      const playerNames = team.players?.map(p => p.nickname || p.fullName) || [];
      
      return {
        rank,
        teamId: team._id,
        teamName: team.teamName,
        teamPhotoUrl: photoUrl, 
        players: playerNames,
        fullPlayers: team.players 
      };
    };

    // 3. วนลูปประมวลผลแมตช์
    for (const m of matches) {
      const level = m.handLevel;
      const type = isLowerBracket(m) ? "lower" : "upper";

      if (!hallOfFame[level]) hallOfFame[level] = { upper: [], lower: [] };

      const winner = m.winner;
      const loser = String(m.winner._id) === String(m.team1._id) ? m.team2 : m.team1;

      // --- กรณีรอบชิง (Final) ---
      if (["F", "Final", "CN"].includes(m.round)) {
        hallOfFame[level][type].push(formatTeam(winner, 1));
        hallOfFame[level][type].push(formatTeam(loser, 2));
      }
      
      // --- กรณีรอบรอง (Semi Final) ---
      else if (["SF", "Semi Final"].includes(m.round)) {
        hallOfFame[level][type].push(formatTeam(loser, 3));
      }
    }

    // 4. Clean Data & Sort
    Object.keys(hallOfFame).forEach(level => {
      ["upper", "lower"].forEach(type => {
        const teams = hallOfFame[level][type];
        
        const uniqueTeams = [];
        const map = new Map();
        for (const item of teams) {
          if(!item) continue;
          if (!map.has(String(item.teamId))) {
            map.set(String(item.teamId), item);
            uniqueTeams.push(item);
          } else {
             const existing = map.get(String(item.teamId));
             if (item.rank < existing.rank) {
                existing.rank = item.rank;
             }
          }
        }
        
        hallOfFame[level][type] = uniqueTeams.sort((a, b) => a.rank - b.rank);
      });
    });

    res.json(hallOfFame);

  } catch (e) {
    next(e);
  }
});

// ==========================================
// EXISTING ROUTES
// ==========================================

router.post("/", authMiddleware, requireAdmin, async (req, res, next) => {
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

router.get("/", async (req, res, next) => {
  try {
    const list = await Tournament.find().sort({ createdAt: -1 }); 
    res.json(list);
  } catch(e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
    try {
        const t = await Tournament.findById(req.params.id);
        if(!t) return res.status(404).json({message:"Not Found"});
        res.json(t);
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

router.post('/generate-groups/manual', authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const result = await TournamentService.manualGroupAndGenerate(req.body);
    return res.status(201).json(result);
  } catch (err) { next(err); }
});

router.post('/generate-groups', authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const {
      handLevel,
      tournamentId = 'default',
      groupNames,
      teamsPerGroup = 4,
    } = req.body || {};

    const level = normalizeHand(handLevel);
    if (!level) throw new Error("handLevel is required for auto-generation");

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

router.get("/standings", async (req, res, next) => {
  try {
    const { handLevel, tournamentId } = req.query;
    if (!handLevel) return res.status(400).json({ message: "handLevel required" });
    const data = await TournamentService.getStandings(handLevel, tournamentId);
    res.json(data);
  } catch (err) { next(err); }
});

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