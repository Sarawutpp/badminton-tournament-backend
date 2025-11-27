// routes/standings.routes.js

const express = require("express");
const router = express.Router();
const Team = require("../models/team.model");
const Match = require("../models/match.model");
const { calculateSetsAndScores, decideMatchOutcome } = require("../utils/scoreUtils");

// GET Standings (เหมือนเดิม)
router.get("/", async (req, res) => {
  try {
    const { handLevel, tournamentId } = req.query;
    if (!handLevel) return res.status(400).json({ message: "handLevel required" });

    const query = { handLevel };
    if (tournamentId) query.tournamentId = tournamentId;

    const teams = await Team.find(query)
      .populate("players", "fullName nickname name")
      .sort({ group: 1, teamName: 1 })
      .lean();

    // จัดกลุ่มและ sort ตามกติกา
    const groupsMap = {};
    teams.forEach((t) => {
      const groupName = t.group || "-";
      if (!groupsMap[groupName]) groupsMap[groupName] = [];
      groupsMap[groupName].push(t);
    });

    const groups = Object.keys(groupsMap).sort().map((groupName) => {
      const list = groupsMap[groupName];
      list.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        const sdA = (a.setsFor||0) - (a.setsAgainst||0);
        const sdB = (b.setsFor||0) - (b.setsAgainst||0);
        if (sdA !== sdB) return sdB - sdA;
        const scdA = (a.scoreFor||0) - (a.scoreAgainst||0);
        const scdB = (b.scoreFor||0) - (b.scoreAgainst||0);
        if (scdA !== scdB) return scdB - scdA;
        return (b.wins||0) - (a.wins||0);
      });
      return { groupName, teams: list };
    });

    res.json({ level: handLevel, tournamentId, groups });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * POST /recalculate
 * ล้างค่าสถิติทีมทั้งหมด แล้วดึงแมตช์ที่จบแล้วมาบวกเข้าไปใหม่ (Sync Data)
 */
router.post("/recalculate", async (req, res) => {
  try {
    const { handLevel, tournamentId } = req.body || {};
    if (!handLevel) return res.status(400).json({ message: "handLevel is required" });

    const filter = { handLevel };
    if (tournamentId) filter.tournamentId = tournamentId;

    // 1. Reset ทีมทั้งหมดในรุ่นนี้ให้เป็น 0 และ matchScores ว่าง
    const zeroStats = {
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
      matchScores: [] // ล้างประวัติด้วย
    };
    await Team.updateMany(filter, { $set: zeroStats });

    // 2. ดึงแมตช์ที่จบแล้ว (status="finished") มาคำนวณใหม่
    const finishedMatches = await Match.find({ 
      ...filter, 
      status: "finished",
      roundType: "group" // คำนวณเฉพาะรอบแบ่งกลุ่ม
    });

    console.log(`[Recalculate] Found ${finishedMatches.length} finished matches.`);

    // 3. วนลูปคำนวณและอัปเดตทีม (ทำทีละแมตช์เพื่อความชัวร์)
    // หมายเหตุ: การวนลูป query อาจช้าถ้าข้อมูลเยอะมาก แต่สำหรับหลักร้อยคู่ถือว่ารับได้
    for (const match of finishedMatches) {
      if (!match.team1 || !match.team2) continue;

      const { outcome, score1, score2, setsWon1, setsWon2 } = decideMatchOutcome({
        sets: match.sets || [],
        gamesToWin: match.gamesToWin,
        allowDraw: match.allowDraw
      });

      // เตรียมข้อมูลที่จะอัปเดต Team 1
      const update1 = { $inc: {}, $push: {} };
      // เตรียมข้อมูลที่จะอัปเดต Team 2
      const update2 = { $inc: {}, $push: {} };

      // Helper ในการบวกเลข
      const incStats = (updateObj, isWin, isDraw, isLoss, sFor, sAg, ptFor, ptAg) => {
        const u = updateObj.$inc;
        u.matchesPlayed = 1;
        if(isWin) { u.wins = 1; u.points = 3; }
        if(isDraw) { u.draws = 1; u.points = 1; }
        if(isLoss) { u.losses = 1; u.points = 0; }
        
        u.setsFor = sFor;
        u.setsAgainst = sAg;
        u.scoreFor = ptFor;
        u.scoreAgainst = ptAg;
        
        // Diff คำนวณตอนแสดงผล หรือจะเก็บก็ได้ แต่ $inc ไม่รองรับการคำนวณ field - field
        // ดังนั้นเราใช้ Virtual หรือคำนวณปลายทางเอาดีกว่า หรือใช้ aggregation pipeline
        // แต่ใน Schema คุณมี field Diff ถ้าจะใช้ $inc ต้องระวัง
        // วิธีง่ายสุด: บวก scoreDiff ด้วย (ptFor - ptAg)
        u.scoreDiff = ptFor - ptAg;
        u.setsDiff = sFor - sAg;
      };

      // สร้าง String ผลการแข่ง เช่น "2-0"
      const resStr1 = `${setsWon1}-${setsWon2}`; 
      const resStr2 = `${setsWon2}-${setsWon1}`;

      if (outcome === "team1") {
        incStats(update1, true, false, false, setsWon1, setsWon2, score1, score2);
        incStats(update2, false, false, true, setsWon2, setsWon1, score2, score1);
      } else if (outcome === "team2") {
        incStats(update1, false, false, true, setsWon1, setsWon2, score1, score2);
        incStats(update2, true, false, false, setsWon2, setsWon1, score2, score1);
      } else {
        incStats(update1, false, true, false, setsWon1, setsWon2, score1, score2);
        incStats(update2, false, true, false, setsWon2, setsWon1, score2, score1);
      }

      // push match result string
      update1.$push.matchScores = resStr1;
      update2.$push.matchScores = resStr2;

      await Team.findByIdAndUpdate(match.team1, update1);
      await Team.findByIdAndUpdate(match.team2, update2);
    }

    res.json({ 
      message: `Recalculated successfully. Processed ${finishedMatches.length} matches.`,
      matchCount: finishedMatches.length
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// POST /clear (ล้างทิ้งทั้งหมดเริ่มใหม่)
router.post("/clear", async (req, res) => {
  // ... (โค้ดเดิมที่คุณมี หรือโค้ดจากคำตอบก่อนหน้า)
  // แนะนำให้คงไว้เผื่ออยากล้างแมตช์ทิ้งด้วย
  try {
    const { handLevel, tournamentId, resetMatches = true } = req.body || {};
    if (!handLevel) return res.status(400).json({ message: "handLevel required" });
    const filter = { handLevel };
    if (tournamentId) filter.tournamentId = tournamentId;

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
          status: "scheduled", startedAt: null
        }
      });
    }
    res.json({ message: "Cleared standings." });
  } catch(e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;