// routes/standings.routes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose"); // ✅ 1. เพิ่มบรรทัดนี้เพื่อใช้ตรวจสอบ ID
const Team = require("../models/team.model");
const Match = require("../models/match.model");
const Tournament = require("../models/tournament.model");
const TournamentService = require("../services/tournament.service");
const { applyTeamStats } = require("../utils/scoreUtils");
const { authMiddleware, requireAdmin } = require("./auth.routes");

// GET Standings
router.get("/", async (req, res, next) => {
  try {
    const { handLevel, tournamentId } = req.query;
    if (!handLevel) return res.status(400).json({ message: "handLevel query param is required" });

    const data = await TournamentService.getStandings(handLevel, tournamentId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// POST Recalculate (ใช้ Rules จาก DB)
router.post("/recalculate", authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const { handLevel, tournamentId } = req.body || {};
    if (!handLevel) return res.status(400).json({ message: "handLevel is required" });

    // 1. เตรียม Filter
    const filter = { handLevel };
    // ✅ ตรวจสอบว่า ID ถูกต้องหรือไม่ก่อนใส่ filter
    if (tournamentId && mongoose.Types.ObjectId.isValid(tournamentId)) {
        filter.tournamentId = tournamentId;
    }

    // 2. ดึง Rules จาก DB
    let rules = { pointsWin: 3, pointsDraw: 1, pointsLose: 0 };
    // ✅ ตรวจสอบว่า ID ถูกต้องหรือไม่ก่อน findById
    if (tournamentId && mongoose.Types.ObjectId.isValid(tournamentId)) {
       const t = await Tournament.findById(tournamentId).select('rules').lean();
       if (t?.rules) rules = t.rules;
    }

    // 3. Reset Stats
    await Team.updateMany(filter, { 
      $set: { 
        matchesPlayed: 0, wins: 0, draws: 0, losses: 0, points: 0,
        scoreFor: 0, scoreAgainst: 0, scoreDiff: 0,
        setsFor: 0, setsAgainst: 0, setsDiff: 0,
        matchScores: [] 
      } 
    });

    // 4. ดึงแมตช์ที่จบแล้ว (เฉพาะ Group)
    const finishedMatches = await Match.find({ 
      ...filter, 
      status: "finished",
      roundType: "group" 
    });

    // 5. Apply Stats
    for (const match of finishedMatches) {
        await applyTeamStats(match, rules);
    }

    res.json({ 
      message: `Recalculated successfully using rules (Win=${rules.pointsWin}).`,
      matchCount: finishedMatches.length
    });

  } catch (err) {
    next(err);
  }
});

// POST Clear (Reset everything)
router.post("/clear", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { handLevel, tournamentId, resetMatches = true } = req.body || {};
    if (!handLevel) return res.status(400).json({ message: "handLevel required" });
    
    const filter = { handLevel };
    // ✅ ตรวจสอบ ID
    if (tournamentId && mongoose.Types.ObjectId.isValid(tournamentId)) {
        filter.tournamentId = tournamentId;
    }

    await Team.updateMany(filter, { 
      $set: { 
        matchesPlayed: 0, wins: 0, draws: 0, losses: 0, points: 0,
        scoreFor: 0, scoreAgainst: 0, scoreDiff: 0,
        setsFor: 0, setsAgainst: 0, setsDiff: 0,
        matchScores: [] 
      } 
    });

    if (resetMatches) {
      await Match.updateMany(filter, {
        $set: {
          score1: 0, score2: 0, sets: [], winner: null,
          status: "scheduled", startedAt: null,
          set1Score1: 0, set1Score2: 0
        }
      });
    }
    res.json({ message: "Cleared standings and matches." });
  } catch(e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;