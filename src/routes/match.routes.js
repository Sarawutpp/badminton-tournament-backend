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
  applyTeamStats,
} = require("../utils/scoreUtils");
const { authMiddleware, requireAdmin } = require("./auth.routes");
const randomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

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
    status: "finished",
  });

  const rules = await getTournamentRules(tournamentId);

  let stats = {
    matchesPlayed: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    points: 0,
    scoreFor: 0,
    scoreAgainst: 0,
    scoreDiff: 0,
    setsFor: 0,
    setsAgainst: 0,
    setsDiff: 0,
    matchScores: [],
  };

  for (const m of matches) {
    const isTeam1 = String(m.team1) === String(teamId);

    const result = decideMatchOutcome({
      sets: m.sets,
      gamesToWin: m.gamesToWin,
      allowDraw: m.allowDraw,
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
      stats.points += rules.pointsDraw ?? 1;
      stats.matchScores.push(rules.pointsDraw ?? 1);
    } else if (
      (isTeam1 && outcome === "team1") ||
      (!isTeam1 && outcome === "team2")
    ) {
      stats.wins++;
      // ✅ แก้ Default เป็น 3 คะแนน
      stats.points += rules.pointsWin ?? 3;
      stats.matchScores.push(rules.pointsWin ?? 3);
    } else {
      stats.losses++;
      stats.points += rules.pointsLose ?? 0;
      stats.matchScores.push(rules.pointsLose ?? 0);
    }
  }

  stats.scoreDiff = stats.scoreFor - stats.scoreAgainst;
  stats.setsDiff = stats.setsFor - stats.setsAgainst;

  await Team.findByIdAndUpdate(teamId, { $set: stats });
}
function generateNoDeuceSet(winnerIsTeam1, isCloseGame) {
  const winnerScore = 21; // ไม่มีดิว ชนะที่ 21 เสมอ
  let loserScore;

  if (isCloseGame) {
    // เกมสูสี: แพ้ที่ 19 หรือ 20
    loserScore = randomInt(19, 20);
  } else {
    // เกมทั่วไป: แพ้ที่ 5 - 18
    loserScore = randomInt(5, 18);
  }

  return {
    t1: winnerIsTeam1 ? winnerScore : loserScore,
    t2: winnerIsTeam1 ? loserScore : winnerScore,
  };
}

// ------------------------------------------------------------------
// Routes
// ------------------------------------------------------------------

// 1. Mock Scores Route
router.post(
  "/mock-scores",
  authMiddleware,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { handLevel, tournamentId } = req.body;

      // Filter เอาเฉพาะแมตช์ที่ยังไม่แข่ง
      const filter = {
        roundType: "group",
        status: "scheduled",
      };

      if (handLevel) filter.handLevel = handLevel;
      if (tournamentId && mongoose.Types.ObjectId.isValid(tournamentId)) {
        filter.tournamentId = tournamentId;
      }

      const matches = await Match.find(filter);

      if (matches.length === 0) {
        return res.json({
          message: "ไม่พบแมตช์ที่ต้อง Mock (อาจจะแข่งจบหมดแล้ว)",
        });
      }

      const rules = await getTournamentRules(tournamentId);

      // Helper: สุ่มลูกแบด 1-4 ลูก
      const randomShuttlecock = () => Math.floor(Math.random() * 4) + 1;

      let count = 0;
      for (const m of matches) {
        // -----------------------------------------------------
        // ส่วนที่ 1: สุ่มและตัดยอดลูกแบด (Shuttlecock Logic)
        // -----------------------------------------------------
        const shuttlecockUsed = randomShuttlecock(); // สุ่ม 1-4 ลูก
        m.shuttlecockUsed = shuttlecockUsed;

        // อัปเดตยอดใช้คูปองของทั้ง 2 ทีมทันที (ตัดทีมละเท่าจำนวนลูกที่ใช้)
        if (m.team1) {
          await Team.findByIdAndUpdate(m.team1, {
            $inc: { couponsUsed: shuttlecockUsed },
          });
        }
        if (m.team2) {
          await Team.findByIdAndUpdate(m.team2, {
            $inc: { couponsUsed: shuttlecockUsed },
          });
        }

        // -----------------------------------------------------
        // ส่วนที่ 2: สุ่มคะแนนแข่งขัน (Scoring Logic)
        // -----------------------------------------------------
        // 1. กำหนดโอกาสเกิด "เสมอ 1-1 เซ็ต" (40%)
        const isDraw = Math.random() < 0.4;

        // 2. สุ่มความสูสี (70% ให้แต้มเบียดกัน)
        const isCloseGame = Math.random() > 0.3;

        let sets = [];

        if (isDraw) {
          // --- กรณีเสมอ (1-1 เซ็ต) ---
          sets.push(generateNoDeuceSet(true, isCloseGame)); // A ชนะ
          sets.push(generateNoDeuceSet(false, isCloseGame)); // B ชนะ
        } else {
          // --- กรณีมีผู้ชนะ (2-0 เซ็ต) ---
          const team1Wins = Math.random() > 0.5; // สุ่มว่าใครชนะ
          sets.push(generateNoDeuceSet(team1Wins, isCloseGame));
          sets.push(generateNoDeuceSet(team1Wins, isCloseGame));
        }

        // Config ให้รองรับการเสมอ
        m.allowDraw = true;

        // --- Save ลง DB ---
        const calc = calculateSetsAndScores(sets);

        m.sets = calc.normalizedSets;
        m.score1 = calc.score1;
        m.score2 = calc.score2;
        m.set1Score1 = calc.normalizedSets[0]?.t1 || 0;
        m.set1Score2 = calc.normalizedSets[0]?.t2 || 0;
        m.set2Score1 = calc.normalizedSets[1]?.t1 || 0;
        m.set2Score2 = calc.normalizedSets[1]?.t2 || 0;

        m.status = "finished";

        // ตัดสินผู้ชนะ (Group Stage: เสมอได้ winner เป็น null)
        if (calc.setsWon1 > calc.setsWon2) m.winner = m.team1;
        else if (calc.setsWon2 > calc.setsWon1) m.winner = m.team2;
        else m.winner = null;

        const savedMatch = await m.save();

        // อัปเดตตารางคะแนนรวม (Wins/Losses/Points)
        await applyTeamStats(savedMatch, rules);
        count++;
      }

      res.json({
        success: true,
        message: `Mock คะแนน + ตัดลูกแบดเรียบร้อย (${count} แมตช์)`,
        handLevel,
      });
    } catch (e) {
      next(e);
    }
  }
);

// 2. Generate Knockout Auto
router.post(
  "/generate-knockout-auto",
  authMiddleware,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { handLevel, round, tournamentId } = req.body;

      if (!handLevel || !round) {
        return res.status(400).json({ message: "Missing handLevel or round" });
      }

      const result = await knockoutService.autoGenerateKnockoutFromStandings({
        handLevel,
        roundCode: round,
        tournamentId,
      });

      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

// Standard CRUD Routes (ละไว้ส่วนเดิม... เหมือนเดิมทุกประการ)
// ... (ส่วน GET, POST, PUT, DELETE ปกติ ไม่ต้องแก้)
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
      court,
    } = req.query;

    const filter = {};
    if (tournamentId && mongoose.Types.ObjectId.isValid(tournamentId))
      filter.tournamentId = tournamentId;
    if (handLevel) filter.handLevel = handLevel;
    if (group) filter.group = group;
    if (roundType) filter.roundType = roundType;
    if (round) filter.round = round;
    if (court) filter.court = String(court);

    if (status) {
      const arr = status
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (arr.length > 0) filter.status = { $in: arr };
    }

    if (q) {
      const regex = new RegExp(q, "i");
      const teamFilter = { teamName: regex };
      if (filter.tournamentId) teamFilter.tournamentId = filter.tournamentId;
      const matchingTeams = await Team.find(teamFilter).select("_id");
      const teamIds = matchingTeams.map((t) => t._id);
      filter.$or = [
        { matchId: regex },
        { round: regex },
        { team1: { $in: teamIds } },
        { team2: { $in: teamIds } },
      ];
    }

    const sOpt = {};
    if (sort) {
      const parts = sort.split(",");
      parts.forEach((p) => {
        const [k, d] = p.split(":");
        sOpt[k] = d === "desc" ? -1 : 1;
      });
    } else {
      sOpt.matchNo = 1;
    }

    const p = Math.max(1, parseInt(page) || 1);
    const ps = Math.min(5000, Math.max(1, parseInt(pageSize) || 50));
    const skip = (p - 1) * ps;

    const [total, items] = await Promise.all([
      Match.countDocuments(filter),
      Match.find(filter)
        .populate({
          path: "team1",
          populate: { path: "players", select: "fullName nickname" },
        })
        .populate({
          path: "team2",
          populate: { path: "players", select: "fullName nickname" },
        })
        .sort(sOpt)
        .skip(skip)
        .limit(ps),
    ]);
    res.json({ items, total, page: p, pageSize: ps });
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(404).json({ message: "Invalid ID" });
    const m = await Match.findById(req.params.id)
      .populate("team1")
      .populate("team2");
    if (!m) return res.status(404).json({ message: "Not found" });
    res.json(m);
  } catch (e) {
    next(e);
  }
});

router.post("/", authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const m = new Match(req.body);
    res.status(201).json(await m.save());
  } catch (e) {
    next(e);
  }
});

router.put("/:id", authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const { settings, ...otherUpdates } = req.body;

    const tournament = await Tournament.findById(req.params.id);
    if (!tournament)
      return res.status(404).json({ message: "Tournament not found" });

    // Update Top Level Fields
    Object.keys(otherUpdates).forEach((key) => {
      tournament[key] = otherUpdates[key];
    });

    // Merge Settings (ถ้ามี)
    if (settings) {
      if (settings.shuttlecock) {
        tournament.settings.shuttlecock = {
          ...tournament.settings.shuttlecock, // ค่าเดิม
          ...settings.shuttlecock, // ค่าใหม่ทับ
        };
      }
      // Merge อื่นๆ ถ้ามีส่งมาด้วย
      if (settings.matchConfig)
        tournament.settings.matchConfig = settings.matchConfig;
      if (settings.categories)
        tournament.settings.categories = settings.categories;
      if (settings.totalCourts)
        tournament.settings.totalCourts = settings.totalCourts;
    }

    const updated = await tournament.save();
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.put(
  "/:id/schedule",
  authMiddleware,
  requireAdmin,
  async (req, res, next) => {
    try {
      const keys = [
        "scheduledAt",
        "startedAt",
        "startTime",
        "estimatedStartTime",
        "court",
        "courtNo",
        "status",
        "matchNo",
        "day",
        "isHold",
      ];
      const up = {};
      keys.forEach((k) => {
        if (req.body[k] !== undefined) up[k] = req.body[k];
      });
      const u = await Match.findByIdAndUpdate(
        req.params.id,
        { $set: up },
        { new: true, runValidators: true }
      );
      if (!u) return res.status(404).json({ message: "Not found" });
      res.json(u);
    } catch (e) {
      next(e);
    }
  }
);

router.patch(
  "/reorder",
  authMiddleware,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { orderedIds } = req.body || {};
      if (!Array.isArray(orderedIds))
        return res.status(400).json({ message: "Required array" });
      const ops = orderedIds.map((id, i) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { matchNo: i + 1, orderIndex: i + 1 } },
        },
      }));
      const r = await Match.bulkWrite(ops);
      res.json({ updated: r.modifiedCount });
    } catch (e) {
      next(e);
    }
  }
);

router.delete("/:id", authMiddleware, requireAdmin, async (req, res, next) => {
  try {
    const m = await Match.findByIdAndDelete(req.params.id);
    if (!m) return res.status(404).json({ message: "Not found" });
    res.json({ message: "Deleted" });
  } catch (e) {
    next(e);
  }
});
// ✅ [NEW] 1. เตรียมทีมวาง (Reset & Seed)
router.post(
  "/prepare-seeds",
  authMiddleware,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { handLevel, tournamentId } = req.body;
      if (!handLevel)
        return res.status(400).json({ message: "Missing handLevel" });

      const result = await knockoutService.prepareUpperBracketSeeds({
        handLevel,
        tournamentId,
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

// ✅ [NEW] 2. จับคู่ / เลือกคู่แข่ง (Manual Pairing)
router.patch(
  "/:id/pairing",
  authMiddleware,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { team1Id, team2Id } = req.body;
      const updateData = {};

      if (team1Id !== undefined) updateData.team1 = team1Id;
      if (team2Id !== undefined) updateData.team2 = team2Id;

      // Reset status
      updateData.status = "scheduled";
      updateData.winner = null;
      updateData.score1 = 0;
      updateData.score2 = 0;
      updateData.sets = [];

      const match = await Match.findByIdAndUpdate(
        req.params.id,
        { $set: updateData },
        { new: true }
      )
        .populate("team1")
        .populate("team2");

      if (!match) return res.status(404).json({ message: "Match not found" });

      res.json(match);
    } catch (e) {
      next(e);
    }
  }
);

// Scoring Route
router.put(
  "/:id/score",
  authMiddleware,
  requireAdmin,
  async (req, res, next) => {
    try {
      // 1. ค้นหา Match
      const match = await Match.findById(req.params.id);
      if (!match) return res.status(404).json({ message: "Match not found" });

      // รับค่าจาก Body
      const { sets: rawSets, shuttlecockUsed } = req.body || {};

      // 2. Logic ตัดลูกแบด / คูปอง (Shuttlecock & Coupons)
      if (shuttlecockUsed !== undefined && shuttlecockUsed !== null) {
        const usedAmount = Number(shuttlecockUsed);

        // บันทึกลง Match
        match.shuttlecockUsed = usedAmount;

        // หักคูปองทีม (หารกันคนละครึ่ง หรือ หักตามจำนวนที่ใช้ แล้วแต่ Business Logic)
        // ในที่นี้ยึดตามโค้ดเดิม: ใช้กี่ลูก หักทีมละเท่านั้นใบ (ถ้าต้องการหารต้องแก้ Logic ตรงนี้)
        const couponsToDeduct = usedAmount;

        if (match.team1) {
          await Team.findByIdAndUpdate(match.team1, {
            $inc: { couponsUsed: couponsToDeduct },
          });
        }
        if (match.team2) {
          await Team.findByIdAndUpdate(match.team2, {
            $inc: { couponsUsed: couponsToDeduct },
          });
        }
      }

      // 3. คำนวณคะแนนและหาผู้ชนะ (Scoring Calculation)
      // เรียกใช้ Utils ที่คุณมีอยู่แล้ว
      const calc = calculateSetsAndScores(rawSets || match.sets || []);

      // อัปเดตข้อมูลลง Object Match
      match.sets = calc.normalizedSets;
      match.score1 = calc.score1;
      match.score2 = calc.score2;
      match.status = "finished"; // บังคับจบแมทช์เมื่อมีการบันทึกคะแนน

      // กำหนดผู้ชนะ (Winner Logic)
      if (calc.setsWon1 > calc.setsWon2) {
        match.winner = match.team1;
      } else if (calc.setsWon2 > calc.setsWon1) {
        match.winner = match.team2;
      } else {
        match.winner = null; // เสมอ
      }

      // 4. บันทึกข้อมูลลง Database
      const savedMatch = await match.save();

      // ==================================================================================
      // 5. [CRITICAL FIX] ส่งผู้ชนะเข้ารอบต่อไป (Auto Advance Flow)
      // ==================================================================================
      // เช็คว่าเป็นรอบ Knockout และมีผู้ชนะหรือไม่
      if (savedMatch.roundType === "knockout" && savedMatch.winner) {
        console.log(`🚀 Advancing winner for match ${savedMatch.matchId}...`);
        await knockoutService.advanceKnockoutWinner(savedMatch);
      }

      if (savedMatch.roundType === "group") {
        await syncTeamStats(
          savedMatch.team1,
          match.handLevel,
          match.tournamentId
        );
        await syncTeamStats(
          savedMatch.team2,
          match.handLevel,
          match.tournamentId
        );
      }

      res.json(savedMatch);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/reset-knockout",
  authMiddleware,
  requireAdmin,
  async (req, res, next) => {
    try {
      const { tournamentId, handLevel } = req.body;

      if (!tournamentId || !handLevel) {
        return res
          .status(400)
          .json({ message: "Missing tournamentId or handLevel" });
      }

      // อัปเดตทุกแมตช์ที่เป็น Knockout ในรุ่นนั้น
      const result = await Match.updateMany(
        {
          tournamentId,
          handLevel,
          roundType: "knockout",
        },
        {
          $set: {
            team1: null,
            team2: null,
            winner: null,
            score1: 0,
            score2: 0,
            sets: [],

            // Reset Legacy fields (กันเหนียว)
            set1Score1: 0,
            set1Score2: 0,
            set2Score1: 0,
            set2Score2: 0,
            set3Score1: 0,
            set3Score2: 0,

            status: "scheduled", // กลับไปเป็นสถานะรอแข่ง
            shuttlecockUsed: 0,
            isBye: false,
          },
        }
      );

      res.json({
        message: "Knockout reset successful",
        modifiedCount: result.modifiedCount,
      });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
