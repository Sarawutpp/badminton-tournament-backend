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
  applyTeamStats, 
  revertTeamStats 
} = require("../utils/scoreUtils");

// Helper: ดึงกติกา (Rules) จาก DB
async function getTournamentRules(tournamentId) {
  if (!tournamentId || !mongoose.Types.ObjectId.isValid(tournamentId)) {
    return { pointsWin: 2, pointsDraw: 1, pointsLose: 0 };
  }
  const tour = await Tournament.findById(tournamentId).select("rules").lean();
  return tour?.rules || { pointsWin: 2, pointsDraw: 1, pointsLose: 0 };
}

// ------------------------------------------------------------------
// Routes
// ------------------------------------------------------------------

// ==========================================
// 1. Special Actions (Mock & Auto Generate)
// ==========================================

// ✅ Mock Scores Route
router.post("/mock-scores", async (req, res, next) => {
  try {
    const { handLevel, tournamentId } = req.body;
    
    // 1. สร้าง Filter หาแมตช์ที่ยังไม่แข่ง และต้องเป็น Group เท่านั้น
    const filter = {
      roundType: "group", 
      status: "scheduled"
    };
    
    if (handLevel) filter.handLevel = handLevel;
    
    // เช็ค tournamentId เพื่อความปลอดภัย
    if (tournamentId && mongoose.Types.ObjectId.isValid(tournamentId)) {
      filter.tournamentId = tournamentId;
    }

    // 2. หาแมตช์
    const matches = await Match.find(filter);

    if (matches.length === 0) {
      return res.json({ message: "ไม่พบแมตช์ที่ต้อง Mock (อาจจะแข่งจบหมดแล้ว)" });
    }

    // 3. ดึง Rules มาเตรียมไว้
    const rules = await getTournamentRules(tournamentId);

    let count = 0;
    for (const m of matches) {
      // สุ่มผู้ชนะ (1 หรือ 2)
      const winnerIdx = Math.random() > 0.5 ? 1 : 2;
      const isThreeSets = Math.random() > 0.7; // 30% โอกาสเกิด 3 เซ็ต
      
      let sets = [];
      // สร้างคะแนนจำลอง
      if (winnerIdx === 1) { 
         if(isThreeSets) sets = [{t1:21,t2:19}, {t1:18,t2:21}, {t1:21,t2:15}];
         else sets = [{t1:21,t2:15}, {t1:21,t2:12}];
      } else { 
         if(isThreeSets) sets = [{t1:19,t2:21}, {t1:21,t1:18}, {t1:15,t2:21}]; 
         else sets = [{t1:10,t2:21}, {t1:15,t2:21}];
      }

      // คำนวณสรุปผล
      const calc = calculateSetsAndScores(sets);
      
      m.sets = calc.normalizedSets;
      m.score1 = calc.score1;
      m.score2 = calc.score2;
      
      // Legacy fields update
      m.set1Score1 = calc.normalizedSets[0]?.t1 || 0;
      m.set1Score2 = calc.normalizedSets[0]?.t2 || 0;
      m.set2Score1 = calc.normalizedSets[1]?.t1 || 0;
      m.set2Score2 = calc.normalizedSets[1]?.t2 || 0;
      
      m.status = "finished";
      
      if (calc.setsWon1 > calc.setsWon2) m.winner = m.team1;
      else if (calc.setsWon2 > calc.setsWon1) m.winner = m.team2;
      else m.winner = null;

      const savedMatch = await m.save();
      
      // ✅ Mock เฉพาะ Group จึงเรียก applyTeamStats ได้เลย (เพราะ filter ไว้แล้ว)
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

// ✅ Generate Knockout Auto
router.post("/generate-knockout-auto", async (req, res, next) => {
  try {
    const { handLevel, round, tournamentId } = req.body;
    
    if (!handLevel || !round) {
      return res.status(400).json({ message: "Missing handLevel or round" });
    }

    const result = await knockoutService.autoGenerateKnockoutFromStandings({
      handLevel,
      roundCode: round,
      tournamentId // ส่ง tournamentId เข้าไปด้วย
    });

    res.json(result);
  } catch (e) {
    next(e);
  }
});

// ==========================================
// 2. Standard CRUD Routes
// ==========================================

// GET Matches
router.get("/", async (req, res, next) => {
  try {
    const { 
      tournamentId, 
      handLevel, 
      group, 
      roundType, 
      round, 
      status, 
      q, 
      sort, 
      page, 
      pageSize, 
      court 
    } = req.query;
    
    const filter = {};
    
    if (tournamentId && mongoose.Types.ObjectId.isValid(tournamentId)) {
       filter.tournamentId = tournamentId;
    } 

    if (handLevel) filter.handLevel = handLevel;
    if (group) filter.group = group;
    if (roundType) filter.roundType = roundType;
    if (round) filter.round = round;
    if (court) filter.court = String(court);

    if (status) {
      const arr = status.split(",").map(s => s.trim()).filter(Boolean);
      if (arr.length > 0) filter.status = { $in: arr };
    }

    // Search Logic
    if (q) {
      const regex = new RegExp(q, "i");
      
      const teamFilter = { teamName: regex };
      if (filter.tournamentId) {
          teamFilter.tournamentId = filter.tournamentId;
      }

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
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(404).json({message:"Invalid ID"});
    }
    const m = await Match.findById(req.params.id).populate("team1").populate("team2");
    if(!m) return res.status(404).json({message:"Not found"});
    res.json(m);
  } catch(e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
     const m = new Match(req.body);
     res.status(201).json(await m.save());
  } catch(e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const u = await Match.findByIdAndUpdate(req.params.id, req.body, {new:true});
    if(!u) return res.status(404).json({message:"Not found"});
    res.json(u);
  } catch(e) { next(e); }
});

router.put("/:id/schedule", async (req, res, next) => {
  try {
    const keys = ["scheduledAt","startedAt","startTime","estimatedStartTime","court","courtNo","status","matchNo","day"];
    const up = {};
    keys.forEach(k => { if(req.body[k]!==undefined) up[k] = req.body[k]; });
    const u = await Match.findByIdAndUpdate(req.params.id, {$set:up}, {new:true, runValidators:true});
    if(!u) return res.status(404).json({message:"Not found"});
    res.json(u);
  } catch(e) { next(e); }
});

router.patch("/reorder", async (req, res, next) => {
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

router.delete("/:id", async (req, res, next) => {
  try {
    const m = await Match.findByIdAndDelete(req.params.id);
    if(!m) return res.status(404).json({message:"Not found"});
    res.json({message:"Deleted"});
  } catch(e) { next(e); }
});

// ==========================================
// 3. Scoring Route (Manual Update)
// ==========================================
router.put("/:id/score", async (req, res, next) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ message: "Match not found" });

    // 1. เตรียม Rules ก่อน
    const rules = await getTournamentRules(match.tournamentId);

    // 2. ถ้าเคยแข่งจบแล้ว ให้ถอยค่าสถิติเดิมออกก่อน (Revert)
    // ✅ [FIX] เช็คเพิ่ม: ต้องเป็น Group เท่านั้นถึงจะถอยแต้ม
    if (match.status === "finished" && match.roundType === "group") {
        await revertTeamStats(match, rules);
    }

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

    // 3. ใส่ค่าสถิติใหม่เข้าไป (Apply)
    // ✅ [FIX] เช็คเพิ่ม: ต้องเป็น Group เท่านั้นถึงจะบวกแต้ม
    if (savedMatch.roundType === "group") {
       await applyTeamStats(savedMatch, rules);
    }

    // Auto-advance Knockout Winner
    if (savedMatch.roundType === "knockout" && savedMatch.status === "finished") {
      await knockoutService.advanceKnockoutWinner(savedMatch);
    }

    res.json(savedMatch);
  } catch (err) {
    next(err);
  }
});

module.exports = router;