// services/tournament.service.js

const mongoose = require("mongoose");
const Team = require("../models/team.model");
const Match = require("../models/match.model");
const { calculateSetsAndScores } = require("../utils/scoreUtils");

// ✅ Import Knockout Service
const knockoutService = require("./knockout.service");

// ----------------------------------------------------------------------
// CONSTANTS & HELPERS
// ----------------------------------------------------------------------

const POINTS_WIN = 3;
const POINTS_DRAW = 1;
const POINTS_LOSS = 0;

function pad(n, size = 2) { return String(n).padStart(size, "0"); }
function upper(s = "") { return String(s || "").toUpperCase(); }
function oid(x) { return typeof x === "string" ? new mongoose.Types.ObjectId(x) : x; }

function normLetter(s = "") {
  const m = String(s).match(/Group\s+([A-Z])/i);
  return (m ? m[1] : String(s).slice(-1)).toUpperCase();
}

// ID Generator สำหรับ Group Stage
function createGroupMatchId(handLevel, groupLetter, roundNo, masterOrder, padDigits = 2) {
  return `${upper(handLevel)}-${upper(groupLetter)}-R${roundNo}-M${pad(masterOrder, padDigits)}`;
}

// Helper: เปรียบเทียบผลงานทีม (ใช้ใน getStandings)
function comparePerformance(a, b) {
  // 1. ✅ เช็ค Manual Rank ก่อน (ถ้าแอดมินกำหนดมา)
  // ค่า 0 ถือว่าไม่มี manual rank ให้ไปเป็นลำดับท้ายๆ (999)
  const rankA = (a.manualRank && a.manualRank > 0) ? a.manualRank : 999;
  const rankB = (b.manualRank && b.manualRank > 0) ? b.manualRank : 999;

  // ถ้ามีคนใดคนหนึ่งถูก Force Rank ให้เรียงตามนั้นเลย (น้อยไปมาก: 1 มาก่อน 2)
  if (rankA !== rankB) {
      return rankA - rankB;
  }

  // 2. ถ้าไม่มี Manual Rank (หรือเท่ากัน) ให้ใช้เกณฑ์เดิม
  if (b.points !== a.points) return b.points - a.points;
  if (b.setsDiff !== a.setsDiff) return b.setsDiff - a.setsDiff;
  if (b.scoreDiff !== a.scoreDiff) return b.scoreDiff - a.scoreDiff;
  if (b.scoreFor !== a.scoreFor) return b.scoreFor - a.scoreFor;
  
  // 3. ถ้าเท่ากันหมดจริงๆ ให้เทียบชื่อ (เพื่อให้ผลนิ่ง)
  return a.teamName.localeCompare(b.teamName);
}

// Helper: สร้างตารางพบกันหมด (Round Robin)
function buildRoundRobinRounds(teamIds = []) {
  const ids = teamIds.map(oid).slice();
  if (ids.length < 2) return [];
  const even = ids.length % 2 === 0;
  if (!even) ids.push(null); 

  const n = ids.length;
  const rounds = n - 1;
  let arr = ids.slice();

  const makePairsFromArr = (A) => {
    const pairs = [];
    const half = n / 2;
    for (let i = 0; i < half; i++) {
      const a = A[i];
      const b = A[n - 1 - i];
      if (a != null && b != null) pairs.push({ t1: a, t2: b });
    }
    return pairs;
  };

  const out = [];
  for (let r = 1; r <= rounds; r++) {
    out.push({ roundNo: r, pairs: makePairsFromArr(arr) });
    const fixed = arr[0];
    const rotated = [fixed, ...arr.slice(2), arr[1]];
    arr = rotated;
  }
  return out;
}

// Normalize Groups Payload
async function normalizeGroupsPayload(body) {
  const { handLevel } = body || {};
  let groups = body?.groups;
  if (groups && !Array.isArray(groups) && typeof groups === "object") {
    const out = [];
    for (const [k, arr] of Object.entries(groups)) {
      out.push({ letter: normLetter(k), teamIds: (arr || []).map(oid) });
    }
    return out;
  }
  return [];
}

// ----------------------------------------------------------------------
// CORE SERVICES
// ----------------------------------------------------------------------

/**
 * 1. manualGroupAndGenerate
 * - สร้าง Group Matches
 * - ✅ เรียก knockoutService เพื่อสร้าง Skeleton ต่อทันที
 */
async function manualGroupAndGenerate(body) {
  const {
    tournamentId = "default",
    handLevel,
    gamesToWin = 2,
    allowDraw = false,
  } = body || {};

  if (!handLevel) throw new Error("handLevel is required");

  const normGroups = await normalizeGroupsPayload(body);
  if (!normGroups.length) throw new Error("groups is required (non-empty)");

  // 1. ลบแมตช์เก่าทั้งหมดของ HandLevel นี้ (ทั้ง Group และ KO) เพื่อสร้างใหม่ยกชุด
  await Match.deleteMany({ tournamentId, handLevel });

  // อัปเดต Group ของ Team
  for (const g of normGroups) {
    await Team.updateMany({ _id: { $in: g.teamIds } }, { $set: { group: g.letter } });
  }

  // 2. สร้าง Group Matches
  let createdGroups = 0;
  let runningOrder = 1;

  for (const g of normGroups) {
    const rounds = buildRoundRobinRounds(g.teamIds); 
    for (const R of rounds) {
      const roundNo = R.roundNo;
      for (const p of R.pairs) {
        const order = runningOrder++;
        const matchId = createGroupMatchId(handLevel, g.letter, roundNo, order, 2);
        await Match.create({
          tournamentId,
          roundType: "group",
          handLevel,
          group: g.letter,
          round: `Group ${g.letter}`,
          groupRound: roundNo,
          matchNo: order,
          matchId,
          team1: p.t1,
          team2: p.t2,
          gamesToWin,
          allowDraw,
          score1: 0,
          score2: 0,
          status: "scheduled",
        });
        createdGroups++;
      }
    }
  }

  // 3. ✅ เรียกใช้ Knockout Service เพื่อสร้าง Skeleton ต่อท้ายทันที
  // (ส่ง runningOrder ล่าสุดไปให้ เพื่อให้ matchNo เรียงต่อกัน)
  const createdKnockouts = await knockoutService.generateKnockoutSkeleton(tournamentId, handLevel, runningOrder);

  return {
    level: handLevel,
    groups: normGroups.map((g) => ({ letter: g.letter, teamCount: g.teamIds.length })),
    matches: createdGroups,
    knockoutMatches: createdKnockouts,
    totalMatches: createdGroups + createdKnockouts
  };
}

// ------------------------------------------------------
// GET STANDINGS (สำหรับ Group Stage)
// ------------------------------------------------------
async function getStandings(handLevel, tournamentId) {
  if (!handLevel) throw new Error("handLevel is required");
  const query = { handLevel };
  if (tournamentId) query.tournamentId = tournamentId;

  const teams = await Team.find(query)
    .populate("players", "fullName nickname")
    .sort({ group: 1, groupOrder: 1, teamName: 1 })
    .lean();

  const groupsMap = {};
  for (const t of teams) {
    const groupName = t.group || "-";
    if (!groupsMap[groupName]) groupsMap[groupName] = [];

    groupsMap[groupName].push({
      teamId: t._id,
      teamName: t.teamName,
      group: t.group,
      handLevel: t.handLevel,
      players: t.players || [],
      matchesPlayed: Number(t.matchesPlayed || 0),
      wins: Number(t.wins || 0),
      draws: Number(t.draws || 0),
      losses: Number(t.losses || 0),
      points: Number(t.points || 0),
      scoreFor: Number(t.scoreFor || 0),
      scoreAgainst: Number(t.scoreAgainst || 0),
      scoreDiff: (Number(t.scoreFor)||0) - (Number(t.scoreAgainst)||0),
      setsFor: Number(t.setsFor || 0),
      setsAgainst: Number(t.setsAgainst || 0),
      setsDiff: (Number(t.setsFor)||0) - (Number(t.setsAgainst)||0),
      manualRank: t.manualRank || 0,
    });
  }

  const groups = Object.keys(groupsMap).sort().map((groupName) => {
      const list = groupsMap[groupName];
      list.sort((a, b) => comparePerformance(a, b));
      return { groupName, teams: list };
    });

  return { handLevel, tournamentId: tournamentId || null, groups };
}

// ------------------------------------------------------
// Common Services (List, Search, Update Score)
// ------------------------------------------------------

async function listAllMatches() {
  return Match.find({ tournamentId: "default" })
    .populate("team1", "teamName")
    .populate("team2", "teamName")
    .sort({ matchNo: 1 })
    .lean();
}

async function listSchedule({ page = 1, pageSize = 20, handLevel = "", status = "", q = "", sort = "matchNo", roundType = "" } = {}) {
  const query = { tournamentId: "default" };
  if (handLevel) query.handLevel = handLevel;
  
  if (roundType) query.roundType = roundType;

  if (status) {
    const arr = String(status).split(",").map((s) => s.trim()).filter(Boolean);
    query.status = arr.length > 1 ? { $in: arr } : arr[0];
  }

  if (q && String(q).trim()) {
    const text = String(q).trim();
    const regex = new RegExp(text, "i");
    // ค้นหา Team ID ก่อน
    const teamDocs = await Team.find({ teamName: regex }).select("_id").lean();
    const teamIds = teamDocs.map((t) => t._id);
    
    if (teamIds.length) {
      query.$or = [
        { matchId: regex }, 
        { team1: { $in: teamIds } }, 
        { team2: { $in: teamIds } }
      ];
    } else {
      query.matchId = regex;
    }
  }

  const skip = (page - 1) * pageSize;
  const sortObj = {};
  if (sort) {
      const parts = sort.split(",");
      parts.forEach(p => {
          const [key, dir] = p.split(":");
          sortObj[key] = dir === "desc" ? -1 : 1;
      });
  }
  if (Object.keys(sortObj).length === 0) sortObj.matchNo = 1;

  const [total, items] = await Promise.all([
    Match.countDocuments(query),
    Match.find(query)
      .populate("team1", "teamName players")
      .populate("team2", "teamName players")
      .sort(sortObj)
      .skip(skip)
      .limit(pageSize)
      .lean(),
  ]);

  return { items, total, page, pageSize };
}

async function updateSchedule(matchId, patch) {
  const allowedKeys = ["scheduledAt", "court", "status", "startedAt", "day", "matchNo"];
  const updateData = {};
  for (const key of allowedKeys) {
    if (patch[key] !== undefined) updateData[key] = patch[key];
  }
  const match = await Match.findByIdAndUpdate(matchId, { $set: updateData }, { new: true });
  if (!match) throw new Error("Match not found");
  return match;
}

// Reorder Matches (สลับลำดับแมตช์)
async function reorderMatches(orderedIds = []) {
  const bulkOps = orderedIds.map((id, index) => ({
    updateOne: { filter: { _id: id }, update: { $set: { matchNo: index + 1 } } },
  }));
  if (bulkOps.length === 0) return { updated: 0 };
  const result = await Match.bulkWrite(bulkOps);
  return { updated: result.modifiedCount || 0 };
}

// ------------------------------------------------------
// TEAM STATS UPDATE (เรียกใช้เมื่อมีการกรอกคะแนน)
// ------------------------------------------------------

function ensureTeamTournamentId(teamDoc) {
  if (!teamDoc) return;
  if (!teamDoc.tournamentId) teamDoc.tournamentId = "default";
}

function recomputePoints(teamDoc) {
  if (!teamDoc) return;
  const wins = Number(teamDoc.wins || 0);
  const draws = Number(teamDoc.draws || 0);
  const losses = Number(teamDoc.losses || 0);
  teamDoc.points = wins * POINTS_WIN + draws * POINTS_DRAW + losses * POINTS_LOSS;
}

// Revert Stats (ลบค่าเก่าออก)
async function revertTeamStats(oldMatch) {
  if (!oldMatch || oldMatch.status !== "finished" || !oldMatch.team1 || !oldMatch.team2) return;

  const [team1, team2] = await Promise.all([
    Team.findById(oldMatch.team1),
    Team.findById(oldMatch.team2),
  ]);
  if (!team1 || !team2) return;

  const res = calculateSetsAndScores(oldMatch.sets || []);
  
  // Logic Revert... (ลดค่า)
  team1.matchesPlayed = Math.max(0, (team1.matchesPlayed||0) - 1);
  team2.matchesPlayed = Math.max(0, (team2.matchesPlayed||0) - 1);
  
  team1.scoreFor = (team1.scoreFor||0) - res.score1;
  team1.scoreAgainst = (team1.scoreAgainst||0) - res.score2;
  team2.scoreFor = (team2.scoreFor||0) - res.score2;
  team2.scoreAgainst = (team2.scoreAgainst||0) - res.score1;

  team1.setsFor = (team1.setsFor||0) - res.setsWon1;
  team1.setsAgainst = (team1.setsAgainst||0) - res.setsWon2;
  team2.setsFor = (team2.setsFor||0) - res.setsWon2;
  team2.setsAgainst = (team2.setsAgainst||0) - res.setsWon1;

  if (oldMatch.winner) {
      if (String(oldMatch.winner) === String(team1._id)) {
          team1.wins = Math.max(0, (team1.wins||0) - 1);
          team2.losses = Math.max(0, (team2.losses||0) - 1);
      } else {
          team2.wins = Math.max(0, (team2.wins||0) - 1);
          team1.losses = Math.max(0, (team1.losses||0) - 1);
      }
  } else {
      team1.draws = Math.max(0, (team1.draws||0) - 1);
      team2.draws = Math.max(0, (team2.draws||0) - 1);
  }

  // Re-calc diff & points
  team1.scoreDiff = (team1.scoreFor||0) - (team1.scoreAgainst||0);
  team2.scoreDiff = (team2.scoreFor||0) - (team2.scoreAgainst||0);
  team1.setsDiff = (team1.setsFor||0) - (team1.setsAgainst||0);
  team2.setsDiff = (team2.setsFor||0) - (team2.setsAgainst||0);
  recomputePoints(team1);
  recomputePoints(team2);

  await Promise.all([team1.save(), team2.save()]);
}

// Apply Stats (บวกค่าใหม่เข้าไป)
async function applyTeamStats(newMatch) {
  if (!newMatch || newMatch.status !== "finished" || !newMatch.team1 || !newMatch.team2) return;

  const [team1, team2] = await Promise.all([
    Team.findById(newMatch.team1),
    Team.findById(newMatch.team2),
  ]);
  if (!team1 || !team2) return;

  const res = calculateSetsAndScores(newMatch.sets || []);

  // Logic Apply... (เพิ่มค่า)
  team1.matchesPlayed = (team1.matchesPlayed||0) + 1;
  team2.matchesPlayed = (team2.matchesPlayed||0) + 1;

  team1.scoreFor = (team1.scoreFor||0) + res.score1;
  team1.scoreAgainst = (team1.scoreAgainst||0) + res.score2;
  team2.scoreFor = (team2.scoreFor||0) + res.score2;
  team2.scoreAgainst = (team2.scoreAgainst||0) + res.score1;

  team1.setsFor = (team1.setsFor||0) + res.setsWon1;
  team1.setsAgainst = (team1.setsAgainst||0) + res.setsWon2;
  team2.setsFor = (team2.setsFor||0) + res.setsWon2;
  team2.setsAgainst = (team2.setsAgainst||0) + res.setsWon1;

  if (newMatch.winner) {
      if (String(newMatch.winner) === String(team1._id)) {
          team1.wins = (team1.wins||0) + 1;
          team2.losses = (team2.losses||0) + 1;
      } else {
          team2.wins = (team2.wins||0) + 1;
          team1.losses = (team1.losses||0) + 1;
      }
  } else {
      team1.draws = (team1.draws||0) + 1;
      team2.draws = (team2.draws||0) + 1;
  }

  // Re-calc diff & points
  team1.scoreDiff = (team1.scoreFor||0) - (team1.scoreAgainst||0);
  team2.scoreDiff = (team2.scoreFor||0) - (team2.scoreAgainst||0);
  team1.setsDiff = (team1.setsFor||0) - (team1.setsAgainst||0);
  team2.setsDiff = (team2.setsFor||0) - (team2.setsAgainst||0);
  recomputePoints(team1);
  recomputePoints(team2);

  await Promise.all([team1.save(), team2.save()]);
}

// ------------------------------------------------------
// EXPORTS
// ------------------------------------------------------
module.exports = {
  createMatchId: createGroupMatchId,
  manualGroupAndGenerate,
  listAllMatches,
  listSchedule,
  updateSchedule,
  reorderMatches,
  getStandings,
  applyTeamStats,
  revertTeamStats,
};