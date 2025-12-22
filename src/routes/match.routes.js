// routes/match.routes.js

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Match = require("../models/match.model");
const Team = require("../models/team.model");
const Tournament = require("../models/tournament.model"); 
const knockoutService = require("../services/knockout.service");
const { 
  calculateSetsAndScores, 
  decideMatchOutcome, 
  applyTeamStats 
} = require("../utils/scoreUtils");
const { authMiddleware, requireAdmin } = require("./auth.routes");

// Helper: ดึงกติกา (Rules) จาก DB
async function getTournamentRules(tournamentId) {
  if (!tournamentId || !mongoose.Types.ObjectId.isValid(tournamentId)) {
    // ✅ แก้ Default เป็น 3 คะแนน
    return { pointsWin: 3, pointsDraw: 1, pointsLose: 0 };
  }
  const tour = await Tournament.findById(tournamentId).select("rules").lean();
  // ✅ แก้ Default เป็น 3 คะแนน
  return tour?.rules || { pointsWin: 3, pointsDraw: 1, pointsLose: 0 };
}

// Helper ใหม่: นับคะแนนใหม่เฉพาะทีมที่ระบุ (Repair Stats)
async function syncTeamStats(teamId, handLevel, tournamentId) {
  if (!teamId) return;
  
  const matches = await Match.find({
    $or: [{ team1: teamId }, { team2: teamId }],
    handLevel,
    tournamentId,
    roundType: "group",
    status: "finished"
  });

  const rules = await getTournamentRules(tournamentId);

  let stats = {
    matchesPlayed: 0, wins: 0, draws: 0, losses: 0, points: 0,
    scoreFor: 0, scoreAgainst: 0, scoreDiff: 0,
    setsFor: 0, setsAgainst: 0, setsDiff: 0,
    matchScores: [] 
  };

  for (const m of matches) {
    const isTeam1 = String(m.team1) === String(teamId);
    
    const result = decideMatchOutcome({
        sets: m.sets,
        gamesToWin: m.gamesToWin,
        allowDraw: m.allowDraw
    });
    
    const { outcome, score1, score2, setsWon1, setsWon2 } = result;

    stats.matchesPlayed++;
    
    const myScore = isTeam1 ? score1 : score2;
    const oppScore = isTeam1 ? score2 : score1;
    stats.scoreFor += myScore;
    stats.scoreAgainst += oppScore;
    
    const mySets = isTeam1 ? setsWon1 : setsWon2;
    const oppSets = isTeam1 ? setsWon2 : setsWon1;
    stats.setsFor += mySets;
    stats.setsAgainst += oppSets;

    if (outcome === "draw") {
        stats.draws++;
        stats.points += (rules.pointsDraw ?? 1);
        stats.matchScores.push(rules.pointsDraw ?? 1);
    } else if ((isTeam1 && outcome === "team1") || (!isTeam1 && outcome === "team2")) {
        stats.wins++;
        // ✅ แก้ Default เป็น 3 คะแนน
        stats.points += (rules.pointsWin ?? 3); 
        stats.matchScores.push(rules.pointsWin ?? 3);
    } else {
        stats.losses++;
        stats.points += (rules.pointsLose ?? 0);
        stats.matchScores.push(rules.pointsLose ?? 0);
    }
  }

  stats.scoreDiff = stats.scoreFor - stats.scoreAgainst;
  stats.setsDiff = stats.setsFor - stats.setsAgainst;

  await Team.findByIdAndUpdate(teamId, { $set: stats });
}

// ------------------------------------------------------------------
// Routes
// ------------------------------------------------------------------

// 1. Mock Scores Route
router.post("/mock-scores", authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const { handLevel, tournamentId } = req.body;
    
    const filter = {
      roundType: "group", 
      status: "scheduled"
    };
    
    if (handLevel) filter.handLevel = handLevel;
    
    if (tournamentId && mongoose.Types.ObjectId.isValid(tournamentId)) {
      filter.tournamentId = tournamentId;
    }

    const matches = await Match.find(filter);

    if (matches.length === 0) {
      return res.json({ message: "ไม่พบแมตช์ที่ต้อง Mock (อาจจะแข่งจบหมดแล้ว)" });
    }

    const rules = await getTournamentRules(tournamentId);

    let count = 0;
    for (const m of matches) {
      const winnerIdx = Math.random() > 0.5 ? 1 : 2;
      const isThreeSets = Math.random() > 0.7; 
      
      let sets = [];
      if (winnerIdx === 1) { 
         if(isThreeSets) sets = [{t1:21,t2:19}, {t1:18,t2:21}, {t1:21,t2:15}];
         else sets = [{t1:21,t2:15}, {t1:21,t2:12}];
      } else { 
         if(isThreeSets) sets = [{t1:19,t2:21}, {t1:21,t1:18}, {t1:15,t2:21}]; 
         else sets = [{t1:10,t2:21}, {t1:15,t2:21}];
      }

      const calc = calculateSetsAndScores(sets);
      
      m.sets = calc.normalizedSets;
      m.score1 = calc.score1;
      m.score2 = calc.score2;
      m.set1Score1 = calc.normalizedSets[0]?.t1 || 0;
      m.set1Score2 = calc.normalizedSets[0]?.t2 || 0;
      m.set2Score1 = calc.normalizedSets[1]?.t1 || 0;
      m.set2Score2 = calc.normalizedSets[1]?.t2 || 0;
      m.status = "finished";
      
      if (calc.setsWon1 > calc.setsWon2) m.winner = m.team1;
      else if (calc.setsWon2 > calc.setsWon1) m.winner = m.team2;
      else m.winner = null;

      const savedMatch = await m.save();
      await applyTeamStats(savedMatch, rules);
      count++;
    }

    res.json({ 
      success: true, 
      message: `Mock คะแนนเรียบร้อยจำนวน ${count} แมตช์`,
      handLevel 
    });

  } catch (e) {
    next(e);
  }
});

// 2. Generate Knockout Auto
router.post("/generate-knockout-auto", authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const { handLevel, round, tournamentId } = req.body;
    
    if (!handLevel || !round) {
      return res.status(400).json({ message: "Missing handLevel or round" });
    }

    const result = await knockoutService.autoGenerateKnockoutFromStandings({
      handLevel,
      roundCode: round,
      tournamentId 
    });

    res.json(result);
  } catch (e) {
    next(e);
  }
});

// Standard CRUD Routes (ละไว้ส่วนเดิม... เหมือนเดิมทุกประการ)
// ... (ส่วน GET, POST, PUT, DELETE ปกติ ไม่ต้องแก้)
router.get("/", async (req, res, next) => {
  try {
    const { 
      tournamentId, handLevel, group, roundType, round, status, q, sort, page, pageSize, court 
    } = req.query;
    
    const filter = {};
    if (tournamentId && mongoose.Types.ObjectId.isValid(tournamentId)) filter.tournamentId = tournamentId;
    if (handLevel) filter.handLevel = handLevel;
    if (group) filter.group = group;
    if (roundType) filter.roundType = roundType;
    if (round) filter.round = round;
    if (court) filter.court = String(court);

    if (status) {
      const arr = status.split(",").map(s => s.trim()).filter(Boolean);
      if (arr.length > 0) filter.status = { $in: arr };
    }

    if (q) {
      const regex = new RegExp(q, "i");
      const teamFilter = { teamName: regex };
      if (filter.tournamentId) teamFilter.tournamentId = filter.tournamentId;
      const matchingTeams = await Team.find(teamFilter).select('_id');
      const teamIds = matchingTeams.map(t => t._id);
      filter.$or = [
          { matchId: regex },
          { round: regex },
          { team1: { $in: teamIds } },
          { team2: { $in: teamIds } }
      ];
    }

    const sOpt = {};
    if (sort) {
       const parts = sort.split(",");
       parts.forEach(p => {
         const [k, d] = p.split(":");
         sOpt[k] = (d === "desc") ? -1 : 1;
       });
    } else {
       sOpt.matchNo = 1; 
    }

    const p = Math.max(1, parseInt(page)||1);
    const ps = Math.min(5000, Math.max(1, parseInt(pageSize)||50));
    const skip = (p-1)*ps;
    
    const [total, items] = await Promise.all([
       Match.countDocuments(filter),
       Match.find(filter)
          .populate({ path: "team1", populate: { path: "players", select: "fullName nickname" } })
          .populate({ path: "team2", populate: { path: "players", select: "fullName nickname" } })
          .sort(sOpt)
          .skip(skip)
          .limit(ps)
    ]);
    res.json({ items, total, page: p, pageSize: ps });
  } catch(e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({message:"Invalid ID"});
    const m = await Match.findById(req.params.id).populate("team1").populate("team2");
    if(!m) return res.status(404).json({message:"Not found"});
    res.json(m);
  } catch(e) { next(e); }
});

router.post("/", authMiddleware, requireAdmin, async (req, res, next) => {
  try {
     const m = new Match(req.body);
     res.status(201).json(await m.save());
  } catch(e) { next(e); }
});

router.put("/:id", authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const u = await Match.findByIdAndUpdate(req.params.id, req.body, {new:true});
    if(!u) return res.status(404).json({message:"Not found"});
    res.json(u);
  } catch(e) { next(e); }
});

router.put("/:id/schedule", authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const keys = ["scheduledAt","startedAt","startTime","estimatedStartTime","court","courtNo","status","matchNo","day"];
    const up = {};
    keys.forEach(k => { if(req.body[k]!==undefined) up[k] = req.body[k]; });
    const u = await Match.findByIdAndUpdate(req.params.id, {$set:up}, {new:true, runValidators:true});
    if(!u) return res.status(404).json({message:"Not found"});
    res.json(u);
  } catch(e) { next(e); }
});

router.patch("/reorder", authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const { orderedIds } = req.body || {};
    if(!Array.isArray(orderedIds)) return res.status(400).json({message:"Required array"});
    const ops = orderedIds.map((id,i) => ({ 
      updateOne: { 
          filter: {_id:id}, 
          update: { $set: { matchNo: i + 1, orderIndex: i + 1 } } 
      } 
    }));
    const r = await Match.bulkWrite(ops);
    res.json({ updated: r.modifiedCount });
  } catch(e) { next(e); }
});

router.delete("/:id", authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const m = await Match.findByIdAndDelete(req.params.id);
    if(!m) return res.status(404).json({message:"Not found"});
    res.json({message:"Deleted"});
  } catch(e) { next(e); }
});

// Scoring Route
router.put("/:id/score", authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ message: "Match not found" });

    const { sets: rawSets, gamesToWin: gw, allowDraw: ad, status: st } = req.body || {};

    const calc = calculateSetsAndScores(rawSets || match.sets || []);
    const normalizedSets = calc.normalizedSets || []; 
    const { score1, score2, setsWon1, setsWon2 } = calc;

    const gamesToWin = Number(gw || match.gamesToWin || 2);
    const allowDraw = typeof ad === "boolean" ? ad : match.allowDraw;
    const roundType = match.roundType || "group";

    let winner = null;
    if (roundType === "knockout" || !allowDraw) {
      if (setsWon1 >= gamesToWin || setsWon2 >= gamesToWin) {
        winner = setsWon1 > setsWon2 ? match.team1 : match.team2;
      } else if (!allowDraw && setsWon1 !== setsWon2) {
         winner = setsWon1 > setsWon2 ? match.team1 : match.team2;
      }
    } else {
      if (setsWon1 > setsWon2) winner = match.team1;
      else if (setsWon2 > setsWon1) winner = match.team2;
      else winner = null;
    }

    match.sets = normalizedSets;
    match.set1Score1 = normalizedSets[0]?.t1 || 0;
    match.set1Score2 = normalizedSets[0]?.t2 || 0;
    match.set2Score1 = normalizedSets[1]?.t1 || 0;
    match.set2Score2 = normalizedSets[1]?.t2 || 0;
    match.set3Score1 = normalizedSets[2]?.t1 || 0;
    match.set3Score2 = normalizedSets[2]?.t2 || 0;

    match.score1 = score1;
    match.score2 = score2;
    match.winner = winner;
    match.gamesToWin = gamesToWin;
    match.allowDraw = allowDraw;
    match.status = st || "finished";

    const savedMatch = await match.save();

    if (savedMatch.roundType === "group" || savedMatch.group) {
        await Promise.all([
            syncTeamStats(savedMatch.team1, savedMatch.handLevel, savedMatch.tournamentId),
            syncTeamStats(savedMatch.team2, savedMatch.handLevel, savedMatch.tournamentId)
        ]);
    }

    if (savedMatch.roundType === "knockout" && savedMatch.status === "finished") {
      await knockoutService.advanceKnockoutWinner(savedMatch);
    }

    res.json(savedMatch);
  } catch (err) {
    next(err);
  }
});

module.exports = router;