// services/knockout.service.js

const mongoose = require("mongoose");
const Match = require("../models/match.model");
const Team = require("../models/team.model");
const Tournament = require("../models/tournament.model");

// --- Constants & Helpers ---

// รุ่นที่ใช้กติกาพิเศษ (24 ทีม) - ถ้าจะยกเลิก hardcode ให้ลบ array นี้ออกแล้วใช้ logic จำนวนทีมอย่างเดียวก็ได้
const CATEGORIES_24_TEAMS = ["BG(Men)", "BG(Mix)"];

// ลำดับการไหลของรอบการแข่งขัน
const ROUND_FLOW = {
  "KO32": "KO16", 
  "KO16": "QF",
  "QF": "SF",
  "SF": "F",
  "F": null 
};

function pad(n, size = 2) { return String(n).padStart(size, "0"); }
function upper(s = "") { return String(s || "").toUpperCase(); }

function createKoMatchId(handLevel, koCode, masterOrder, padDigits = 2) {
  return `${upper(handLevel)}-${upper(koCode)}-M${pad(masterOrder, padDigits)}`;
}

function shuffleArray(array) {
  const newArr = array.slice();
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

// 1. เปรียบเทียบแบบรวม Manual Rank
function comparePerformance(a, b) {
  const rankA = (a.manualRank && a.manualRank > 0) ? a.manualRank : 999;
  const rankB = (b.manualRank && b.manualRank > 0) ? b.manualRank : 999;
  if (rankA !== rankB) return rankA - rankB;
  return compareStatsOnly(a, b);
}

// 2. เปรียบเทียบแบบดู Stat ล้วนๆ
function compareStatsOnly(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.setsDiff !== a.setsDiff) return b.setsDiff - a.setsDiff;
  if (b.scoreDiff !== a.scoreDiff) return b.scoreDiff - a.scoreDiff;
  if (b.scoreFor !== a.scoreFor) return b.scoreFor - a.scoreFor;
  return a.teamName.localeCompare(b.teamName);
}

// --- Internal: Get Standings for Seeding ---
async function getStandingsForSeeding(handLevel, tournamentId) {
  if (!tournamentId || !mongoose.Types.ObjectId.isValid(tournamentId)) {
      return { groups: [] };
  }
  const teams = await Team.find({ handLevel, tournamentId })
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
      groupRank: 0,
      points: t.points || 0,
      scoreFor: t.scoreFor || 0,
      scoreAgainst: t.scoreAgainst || 0,
      scoreDiff: (t.scoreFor||0) - (t.scoreAgainst||0),
      setsFor: t.setsFor || 0,
      setsAgainst: t.setsAgainst || 0,
      setsDiff: (t.setsFor||0) - (t.setsAgainst||0),
      manualRank: t.manualRank || 0,
    });
  }

  const groups = Object.keys(groupsMap).sort().map((groupName) => {
      const list = groupsMap[groupName];
      list.sort((a, b) => comparePerformance(a, b)); 
      list.forEach((t, i) => t.groupRank = i + 1);
      return { groupName, teams: list };
  });

  return { groups };
}

// ----------------------------------------------------------------------
// 1. Auto Advance Winner
// ----------------------------------------------------------------------
async function advanceKnockoutWinner(match) {
  if (match.roundType !== "knockout" || !match.winner) return;

  const currentRound = match.round;
  const nextRound = ROUND_FLOW[currentRound];
  if (!nextRound) return; 

  const currentLevelMatches = await Match.find({
    tournamentId: match.tournamentId,
    handLevel: match.handLevel,
    round: currentRound,
    bracketSide: match.bracketSide 
  }).sort({ matchNo: 1 });

  const myIndex = currentLevelMatches.findIndex(m => String(m._id) === String(match._id));
  if (myIndex === -1) return;

  const targetIndex = Math.floor(myIndex / 2); 
  const isTeam1Slot = (myIndex % 2 === 0); 

  const nextLevelMatches = await Match.find({
    tournamentId: match.tournamentId,
    handLevel: match.handLevel,
    round: nextRound,
    bracketSide: match.bracketSide
  }).sort({ matchNo: 1 });

  const targetMatch = nextLevelMatches[targetIndex];
  if (!targetMatch) return;

  if (isTeam1Slot) targetMatch.team1 = match.winner;
  else targetMatch.team2 = match.winner;
  
  await targetMatch.save();
  console.log(`✅ Auto Advanced: ${match.handLevel} ${match.bracketSide} Winner -> ${nextRound}`);
}

// ----------------------------------------------------------------------
// 2. Generate Knockout Skeleton (Dynamic Size based on Team Count)
// ----------------------------------------------------------------------
async function generateKnockoutSkeleton(tournamentId, handLevel, startMatchNo, groupCount = 4) {
  if (!tournamentId || !mongoose.Types.ObjectId.isValid(tournamentId)) {
      throw new Error("Invalid tournamentId");
  }

  // 1. นับจำนวนทีมจริง เพื่อเลือกขนาดตารางที่เหมาะสม
  const totalTeams = await Team.countDocuments({ tournamentId, handLevel });
  
  const tour = await Tournament.findById(tournamentId).select("settings").lean();
  const koConfig = tour?.settings?.matchConfig?.knockoutStage || {};
  const gamesToWin = koConfig.gamesToWin || 2;
  const hasDeuce = koConfig.hasDeuce ?? true; 
  const maxScore = koConfig.maxScore || 21;
  const is24Teams = CATEGORIES_24_TEAMS.includes(handLevel);

  let roundsToGenerate = [];

  // ==========================================
  // LOGIC ใหม่: เลือกโครงสร้างตามจำนวนทีม
  // ==========================================
  if (is24Teams || totalTeams > 16) {
      // 17-24+ ทีม: ใช้ KO16 (รองรับได้สูงสุด 32 สล็อต: 16 บน / 16 ล่าง หรือตาม logic 24 ทีม)
      roundsToGenerate = [
        { code: "KO16", count: 8 }, // 8 คู่บน
        { code: "QF", count: 8 },   // 8 คู่ (4 บน / 4 ล่าง)
        { code: "SF", count: 4 },   // 4 คู่ (2 บน / 2 ล่าง)
        { code: "F", count: 2 }     // 2 คู่ (1 บน / 1 ล่าง)
      ];
  } 
  else if (totalTeams > 10) {
      // 9-16 ทีม (เช่น 10 ทีม, 12 ทีม):
      // ใช้ QF 8 คู่ (รองรับ 16 สล็อต: บน 8 / ล่าง 8)
      roundsToGenerate = [
        { code: "QF", count: 8 },
        { code: "SF", count: 4 },
        { code: "F", count: 2 }
      ];
  } 
  else if (totalTeams > 4) {
      // 5-8 ทีม (เช่น 8 ทีม):
      // ใช้ SF 4 คู่ (รองรับ 8 สล็อต: บน 4 / ล่าง 4)
      roundsToGenerate = [
        { code: "SF", count: 4 },
        { code: "F", count: 2 }
      ];
  } 
  else {
      // 1-4 ทีม:
      // ใช้ SF 2 คู่ (รองรับ 4 สล็อต: บน 2 / ล่าง 2)
      roundsToGenerate = [
        { code: "SF", count: 2 },
        { code: "F", count: 2 }
      ];
  }

  let currentMatchNo = startMatchNo;
  const creates = [];

  for (const round of roundsToGenerate) {
    for (let i = 0; i < round.count; i++) {
      const masterOrder = currentMatchNo++;
      const matchId = createKoMatchId(handLevel, round.code, masterOrder, 2);
      
      // Logic ระบุสาย: ครึ่งแรก TOP, ครึ่งหลัง BOTTOM
      // (ยกเว้น KO16 ในเคส 24 ทีมที่อาจจะเป็น TOP ล้วน แต่ logic นี้แบ่งครึ่งไปก่อนได้ เพราะตอนหยอดทีมจะดู BracketSide เป็นหลัก)
      const side = (i < round.count / 2) ? "TOP" : "BOTTOM";

      creates.push({
        tournamentId,
        roundType: "knockout",
        handLevel,
        round: round.code,
        matchNo: masterOrder,
        matchId,
        team1: null,
        team2: null,
        bracketSide: side,
        gamesToWin,
        hasDeuce,
        maxScore,
        allowDraw: false,
        score1: 0,
        score2: 0,
        status: "scheduled",
        isBye: false
      });
    }
  }

  if (creates.length > 0) {
    await Match.insertMany(creates);
  }
  
  return creates.length;
}

// ----------------------------------------------------------------------
// 3. Auto Generate from Standings (Teams Distribution)
// ----------------------------------------------------------------------
async function autoGenerateKnockoutFromStandings({ tournamentId, handLevel }) {
  if (!tournamentId || !mongoose.Types.ObjectId.isValid(tournamentId)) {
      throw new Error("Invalid tournamentId");
  }

  const standings = await getStandingsForSeeding(handLevel, tournamentId);
  const groups = standings.groups || [];
  if (groups.length === 0) throw new Error("ไม่พบข้อมูลกลุ่ม");

  let allTeams = [];
  groups.forEach(g => {
    g.teams.forEach((t) => {
      allTeams.push({ ...t, groupName: g.groupName });
    });
  });

  let upperQualifiers = [];
  let lowerQualifiers = [];
  const is24TeamsRule = CATEGORIES_24_TEAMS.includes(handLevel);

  // --- แยกสาย: ยึดหลัก "มีสายล่างเสมอ" ---
  if (is24TeamsRule) {
     // กฎพิเศษ 24 ทีม: ที่ 1, 2 + Best 3rd ขึ้นบน / ที่เหลือลงล่าง
     const rank1s = allTeams.filter(t => t.groupRank === 1);
     const rank2s = allTeams.filter(t => t.groupRank === 2);
     const rank3s = allTeams.filter(t => t.groupRank === 3);
     const rank4s = allTeams.filter(t => t.groupRank === 4);
     rank3s.sort((a, b) => compareStatsOnly(a, b));
     const best3rd = rank3s.slice(0, 4);
     const remaining3rd = rank3s.slice(4);
     upperQualifiers = [...rank1s, ...rank2s, ...best3rd];
     lowerQualifiers = [...remaining3rd, ...rank4s];
  } 
  else {
     // สายบน: เอาที่ 1-2
     upperQualifiers = allTeams.filter(t => t.groupRank <= 2);
     
     // สายล่าง: แก้ให้เอาเฉพาะที่ 3-4 (ตัดที่ 5 ทิ้ง)
     lowerQualifiers = allTeams.filter(t => t.groupRank >= 3 && t.groupRank <= 4);
  }

  // --- จัด Seeding และจับสลาก ---
  upperQualifiers.sort((a, b) => compareStatsOnly(a, b));
  const half = Math.ceil(upperQualifiers.length / 2);
  const seeds = upperQualifiers.slice(0, half);
  const nonSeeds = shuffleArray(upperQualifiers.slice(half));
  const lowerShuffled = shuffleArray(lowerQualifiers);

  const updateOps = [];
  let updatedCount = 0;

  // 1. หยอดสายบน
  // เลือกเป้าหมาย: ดูว่าคนเยอะแค่ไหน
  // - ถ้า <= 4 ทีม -> ลง SF
  // - ถ้า > 4 และ <= 8 ทีม -> ลง QF
  // - ถ้า > 8 ทีม -> ลง KO16
  let upperRoundTarget = "QF";
  if (upperQualifiers.length <= 4) upperRoundTarget = "SF";
  else if (upperQualifiers.length > 8 || is24TeamsRule) upperRoundTarget = "KO16";

  const upperMatches = await Match.find({
    tournamentId, handLevel, roundType: "knockout", round: upperRoundTarget, bracketSide: "TOP"
  }).sort({ matchNo: 1 });

  let uIdx = 0;
  for (let i = 0; i < seeds.length; i++) {
    // ข้ามแมตช์ที่มีทีมครบแล้ว (กรณีรันซ้ำ)
    while (uIdx < upperMatches.length && upperMatches[uIdx].team1 && upperMatches[uIdx].team2) {
        uIdx++;
    }
    if (uIdx >= upperMatches.length) break;

    const match = upperMatches[uIdx++];
    const t1 = seeds[i].teamId;
    const t2 = nonSeeds[i] ? nonSeeds[i].teamId : null;
    
    updateOps.push({
      updateOne: { filter: { _id: match._id }, update: { $set: { team1: t1, team2: t2, status: "scheduled" } } }
    });
  }

  // 2. หยอดสายล่าง
  if (lowerQualifiers.length > 0) {
      // สายล่างเริ่มรอบเดียวกับสายบนใน level นั้นๆ (ถ้าคนเท่ากัน) หรือปรับตามจำนวนคน
      let lowerRoundTarget = "QF";
      if (lowerQualifiers.length <= 4) lowerRoundTarget = "SF";

      const lowerMatches = await Match.find({
        tournamentId, handLevel, roundType: "knockout", round: lowerRoundTarget, bracketSide: "BOTTOM"
      }).sort({ matchNo: 1 });

      let lIdx = 0;
      for (let i = 0; i < lowerShuffled.length; i += 2) {
        if (lIdx >= lowerMatches.length) break;
        const match = lowerMatches[lIdx++];
        const t1 = lowerShuffled[i] ? lowerShuffled[i].teamId : null;
        const t2 = lowerShuffled[i+1] ? lowerShuffled[i+1].teamId : null;

        updateOps.push({
          updateOne: { filter: { _id: match._id }, update: { $set: { team1: t1, team2: t2, status: "scheduled" } } }
        });
      }
  }

  if (updateOps.length > 0) {
    const res = await Match.bulkWrite(updateOps);
    updatedCount = res.modifiedCount;
  }
  
  const totalSkeleton = await Match.countDocuments({ tournamentId, handLevel, roundType: "knockout" });
  return { updatedMatches: updatedCount, totalSkeleton };
}

async function listKnockout(tournamentId) {
  const filter = { roundType: "knockout" };
  if (tournamentId && mongoose.Types.ObjectId.isValid(tournamentId)) filter.tournamentId = tournamentId;
  const matches = await Match.find(filter)
    .populate("team1", "teamName").populate("team2", "teamName")
    .sort({ round: 1, matchNo: 1 }).lean();
  const rounds = {};
  matches.forEach((m) => {
    const name = m.round || "Knockout";
    if (!rounds[name]) rounds[name] = [];
    rounds[name].push(m);
  });
  return Object.keys(rounds).map((name) => ({ name, matches: rounds[name] }));
}

module.exports = {
  generateKnockoutSkeleton,
  autoGenerateKnockoutFromStandings,
  advanceKnockoutWinner, 
  listKnockout,
  createKoMatchId
};