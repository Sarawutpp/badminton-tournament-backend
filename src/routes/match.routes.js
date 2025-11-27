// routes/match.routes.js

const express = require("express");
const router = express.Router();

const Match = require("../models/match.model");
const Team = require("../models/team.model");
const { calculateSetsAndScores } = require("../utils/scoreUtils");
// ✅ Import Service
const knockoutService = require("../services/knockout.service"); 
const tournamentService = require("../services/tournament.service");

const POINTS_WIN = 3;
const POINTS_DRAW = 1;
const POINTS_LOSS_OR_RETIRE = 0;

// Helper: ตรวจสอบ Tournament ID
function ensureTeamTournamentId(teamDoc, fallbackTournamentId = "default") {
  if (!teamDoc) return;
  if (!teamDoc.tournamentId) {
    teamDoc.tournamentId = fallbackTournamentId;
  } else {
    teamDoc.tournamentId = String(teamDoc.tournamentId);
  }
}

// Helper: คำนวณ Points ใหม่
function recomputePoints(teamDoc) {
  if (!teamDoc) return;
  const wins = Number(teamDoc.wins || 0);
  const draws = Number(teamDoc.draws || 0);
  const losses = Number(teamDoc.losses || 0);

  teamDoc.points =
    wins * POINTS_WIN +
    draws * POINTS_DRAW +
    losses * POINTS_LOSS_OR_RETIRE;
}

// ------------------------------------------------------------------
// 1. REVERT (ถอยค่าเดิมออก)
// ------------------------------------------------------------------
async function revertTeamStats(oldMatch) {
  if (!oldMatch) return;
  if (oldMatch.status !== "finished") return;
  if (!oldMatch.team1 || !oldMatch.team2) return;

  const [team1, team2] = await Promise.all([
    Team.findById(oldMatch.team1),
    Team.findById(oldMatch.team2),
  ]);

  if (!team1 || !team2) return;
  ensureTeamTournamentId(team1);
  ensureTeamTournamentId(team2);

  const res = calculateSetsAndScores(oldMatch.sets || []);
  const score1 = res.score1 || 0;
  const score2 = res.score2 || 0;
  const setsWon1 = res.setsWon1 || 0;
  const setsWon2 = res.setsWon2 || 0;

  team1.matchesPlayed = Math.max(0, (team1.matchesPlayed || 0) - 1);
  team2.matchesPlayed = Math.max(0, (team2.matchesPlayed || 0) - 1);

  team1.scoreFor = (team1.scoreFor || 0) - score1;
  team1.scoreAgainst = (team1.scoreAgainst || 0) - score2;
  team2.scoreFor = (team2.scoreFor || 0) - score2;
  team2.scoreAgainst = (team2.scoreAgainst || 0) - score1;

  team1.setsFor = (team1.setsFor || 0) - setsWon1;
  team1.setsAgainst = (team1.setsAgainst || 0) - setsWon2;
  team2.setsFor = (team2.setsFor || 0) - setsWon2;
  team2.setsAgainst = (team2.setsAgainst || 0) - setsWon1;

  if (oldMatch.winner) {
    if (String(oldMatch.winner) === String(oldMatch.team1)) {
      team1.wins = Math.max(0, (team1.wins || 0) - 1);
      team2.losses = Math.max(0, (team2.losses || 0) - 1);
    } else if (String(oldMatch.winner) === String(oldMatch.team2)) {
      team2.wins = Math.max(0, (team2.wins || 0) - 1);
      team1.losses = Math.max(0, (team1.losses || 0) - 1);
    }
  } else {
    team1.draws = Math.max(0, (team1.draws || 0) - 1);
    team2.draws = Math.max(0, (team2.draws || 0) - 1);
  }

  if (team1.matchScores && team1.matchScores.length > 0) team1.matchScores.pop();
  if (team2.matchScores && team2.matchScores.length > 0) team2.matchScores.pop();

  team1.scoreDiff = (team1.scoreFor || 0) - (team1.scoreAgainst || 0);
  team2.scoreDiff = (team2.scoreFor || 0) - (team2.scoreAgainst || 0);
  team1.setsDiff = (team1.setsFor || 0) - (team1.setsAgainst || 0);
  team2.setsDiff = (team2.setsFor || 0) - (team2.setsAgainst || 0);
  recomputePoints(team1);
  recomputePoints(team2);

  await Promise.all([team1.save(), team2.save()]);
}

// ------------------------------------------------------------------
// 2. APPLY (ใส่ค่าใหม่เข้าไป)
// ------------------------------------------------------------------
async function applyTeamStats(newMatch) {
  if (!newMatch) return;
  if (newMatch.status !== "finished") return;
  if (!newMatch.team1 || !newMatch.team2) return;

  const [team1, team2] = await Promise.all([
    Team.findById(newMatch.team1),
    Team.findById(newMatch.team2),
  ]);

  if (!team1 || !team2) return;
  ensureTeamTournamentId(team1);
  ensureTeamTournamentId(team2);

  const res = calculateSetsAndScores(newMatch.sets || []);
  const score1 = res.score1 || 0;
  const score2 = res.score2 || 0;
  const setsWon1 = res.setsWon1 || 0;
  const setsWon2 = res.setsWon2 || 0;

  team1.matchesPlayed = (team1.matchesPlayed || 0) + 1;
  team2.matchesPlayed = (team2.matchesPlayed || 0) + 1;

  team1.scoreFor = (team1.scoreFor || 0) + score1;
  team1.scoreAgainst = (team1.scoreAgainst || 0) + score2;
  team2.scoreFor = (team2.scoreFor || 0) + score2;
  team2.scoreAgainst = (team2.scoreAgainst || 0) + score1;

  team1.setsFor = (team1.setsFor || 0) + setsWon1;
  team1.setsAgainst = (team1.setsAgainst || 0) + setsWon2;
  team2.setsFor = (team2.setsFor || 0) + setsWon2;
  team2.setsAgainst = (team2.setsAgainst || 0) + setsWon1;

  if (newMatch.winner) {
    if (String(newMatch.winner) === String(newMatch.team1)) {
      team1.wins = (team1.wins || 0) + 1;
      team2.losses = (team2.losses || 0) + 1;
    } else if (String(newMatch.winner) === String(newMatch.team2)) {
      team2.wins = (team2.wins || 0) + 1;
      team1.losses = (team1.losses || 0) + 1;
    }
  } else {
    team1.draws = (team1.draws || 0) + 1;
    team2.draws = (team2.draws || 0) + 1;
  }

  if (!team1.matchScores) team1.matchScores = [];
  if (!team2.matchScores) team2.matchScores = [];
  
  team1.matchScores.push(`${setsWon1}-${setsWon2}`);
  team2.matchScores.push(`${setsWon2}-${setsWon1}`);

  team1.scoreDiff = (team1.scoreFor || 0) - (team1.scoreAgainst || 0);
  team2.scoreDiff = (team2.scoreFor || 0) - (team2.scoreAgainst || 0);
  team1.setsDiff = (team1.setsFor || 0) - (team1.setsAgainst || 0);
  team2.setsDiff = (team2.setsFor || 0) - (team2.setsAgainst || 0);
  recomputePoints(team1);
  recomputePoints(team2);

  await Promise.all([team1.save(), team2.save()]);
}

// ------------------------------------------------------------------
// Routes
// ------------------------------------------------------------------

router.get("/", async (req, res, next) => {
  try {
    const { tournamentId, handLevel, group, roundType, round, status, q, sort, page, pageSize } = req.query;
    const filter = {};
    if (tournamentId) filter.tournamentId = tournamentId;
    if (handLevel) filter.handLevel = handLevel;
    if (group) filter.group = group;
    if (roundType) filter.roundType = roundType;
    if (round) filter.round = round;
    if (status) {
       const s = status.split(",").map(x=>x.trim()).filter(Boolean);
       filter.status = s.length > 1 ? {$in: s} : s[0];
    }
    if (q) {
       const rg = new RegExp(String(q).trim(), "i");
       filter.$or = [{ matchId: rg }, { handLevel: rg }, { group: rg }, { round: rg }, { court: rg }];
    }
    const p = Math.max(1, parseInt(page)||1);
    const ps = Math.min(5000, Math.max(1, parseInt(pageSize)||50));
    const skip = (p-1)*ps;
    
    const sOpt = {};
    if (sort) {
       String(sort).split(",").forEach(f => {
         let k = f.trim();
         let d = 1;
         if (k.startsWith("-")) { d = -1; k = k.slice(1); }
         if (k) sOpt[k] = d;
       });
    }
    if (!Object.keys(sOpt).length) sOpt.matchNo = 1;

    const [total, items] = await Promise.all([
       Match.countDocuments(filter),
       Match.find(filter).populate("team1").populate("team2").sort(sOpt).skip(skip).limit(ps)
    ]);
    res.json({ items, total, page: p, pageSize: ps });
  } catch(e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const m = await Match.findById(req.params.id).populate("team1").populate("team2");
    if(!m) return res.status(404).json({message:"Not found"});
    res.json(m);
  } catch(e) { next(e); }
});

router.post("/generate-knockout-auto", async (req, res, next) => {
  try {
    const { handLevel, round } = req.body;
    
    if (!handLevel || !round) {
      return res.status(400).json({ message: "Missing handLevel or round" });
    }

    const result = await knockoutService.autoGenerateKnockoutFromStandings({
      handLevel,
      roundCode: round,
    });

    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post("/mock-scores", async (req, res, next) => {
  try {
    const { handLevel } = req.body;
    if (!handLevel) return res.status(400).json({ message: "Missing handLevel" });

    const matches = await Match.find({
      handLevel,
      roundType: "group",
      status: "scheduled"
    });

    if (matches.length === 0) {
      return res.json({ message: "ไม่พบแมตช์ที่ต้อง Mock (อาจจะแข่งจบหมดแล้ว)" });
    }

    let count = 0;
    for (const m of matches) {
      const winnerIdx = Math.random() > 0.5 ? 1 : 2;
      const isThreeSets = Math.random() > 0.7; 
      
      let sets = [];
      if (winnerIdx === 1) { 
         if(isThreeSets) sets = [{t1:21,t2:18}, {t1:19,t2:21}, {t1:21,t2:15}];
         else sets = [{t1:21,t2:15}, {t1:21,t2:12}];
      } else { 
         if(isThreeSets) sets = [{t1:18,t2:21}, {t1:21,t2:19}, {t1:15,t2:21}]; 
         else sets = [{t1:10,t2:21}, {t1:15,t2:21}];
      }

      const calc = calculateSetsAndScores(sets);
      
      m.sets = calc.normalizedSets;
      m.score1 = calc.score1;
      m.score2 = calc.score2;
      m.status = "finished";
      m.gamesToWin = 2;
      m.allowDraw = false;

      if (calc.setsWon1 > calc.setsWon2) m.winner = m.team1;
      else if (calc.setsWon2 > calc.setsWon1) m.winner = m.team2;
      else m.winner = null;

      const savedMatch = await m.save();
      await applyTeamStats(savedMatch);
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
    const ops = orderedIds.map((id,i) => ({ updateOne: { filter: {_id:id}, update: {$set:{matchNo:i+1}} } }));
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

// ------------------------------------------------------
// UPDATE SCORE (บันทึกคะแนน และ Auto Advance)
// ------------------------------------------------------
router.put("/:id/score", async (req, res, next) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ message: "Match not found" });

    const previousMatch = match.toObject();
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

    // 1. บันทึก Sets แบบ Array (โครงสร้างใหม่)
    match.sets = normalizedSets;
    match.markModified("sets");

    // 2. [เพิ่มส่วนนี้] Sync กลับไปใส่ Legacy Fields เพื่อให้ดูใน DB ง่ายขึ้น
    // และรองรับโค้ดเก่าที่อาจจะดึง set1Score1 โดยตรง
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

    await revertTeamStats(previousMatch);
    await applyTeamStats(savedMatch);

    if (savedMatch.roundType === "knockout" && savedMatch.status === "finished") {
      await knockoutService.advanceKnockoutWinner(savedMatch);
    }

    res.json(savedMatch);
  } catch (err) {
    next(err);
  }
});

module.exports = router;