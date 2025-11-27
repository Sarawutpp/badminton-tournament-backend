// services/knockout.service.js

const mongoose = require("mongoose");
const Match = require("../models/match.model");
const Team = require("../models/team.model");

// --- Constants & Helpers ---

const CATEGORIES_24_TEAMS = ["BG(Men)", "BG(Mix)"];

// ลำดับการไหลของรอบการแข่งขัน
const ROUND_FLOW = {
  "KO16": "QF",
  "QF": "SF",
  "SF": "F",
  "F": null 
};

function pad(n, size = 2) { return String(n).padStart(size, "0"); }
function upper(s = "") { return String(s || "").toUpperCase(); }
function oid(x) { return typeof x === "string" ? new mongoose.Types.ObjectId(x) : x; }

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

// 1. เปรียบเทียบแบบรวม Manual Rank (ใช้สำหรับจัดอันดับ 1-4 ในกลุ่ม)
function comparePerformance(a, b) {
  const rankA = (a.manualRank && a.manualRank > 0) ? a.manualRank : 999;
  const rankB = (b.manualRank && b.manualRank > 0) ? b.manualRank : 999;

  if (rankA !== rankB) {
      return rankA - rankB;
  }
  return compareStatsOnly(a, b);
}

// 2. เปรียบเทียบแบบดู Stat ล้วนๆ (ใช้สำหรับจัด Seeding ข้ามสาย)
function compareStatsOnly(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.setsDiff !== a.setsDiff) return b.setsDiff - a.setsDiff;
  if (b.scoreDiff !== a.scoreDiff) return b.scoreDiff - a.scoreDiff;
  if (b.scoreFor !== a.scoreFor) return b.scoreFor - a.scoreFor;
  return a.teamName.localeCompare(b.teamName);
}

// --- Internal: Get Standings for Seeding ---
async function getStandingsForSeeding(handLevel, tournamentId) {
  const teams = await Team.find({ handLevel, tournamentId: tournamentId || "default" })
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
// 1. Auto Advance Winner (ฟังก์ชันใหม่: ดันผู้ชนะเข้ารอบต่อไป)
// ----------------------------------------------------------------------
async function advanceKnockoutWinner(match) {
  if (match.roundType !== "knockout" || !match.winner) return;

  const currentRound = match.round;
  const nextRound = ROUND_FLOW[currentRound];
  if (!nextRound) return; // เช่น รอบชิงชนะเลิศ ไม่มีรอบถัดไป

  // ดึงแมตช์ทั้งหมดในรอบปัจจุบัน ของสายเดียวกัน (TOP/BOTTOM) เพื่อหา Index
  const currentLevelMatches = await Match.find({
    tournamentId: match.tournamentId,
    handLevel: match.handLevel,
    round: currentRound,
    bracketSide: match.bracketSide 
  }).sort({ matchNo: 1 });

  const myIndex = currentLevelMatches.findIndex(m => String(m._id) === String(match._id));
  if (myIndex === -1) return;

  // คำนวณตำแหน่งในรอบถัดไป
  const targetIndex = Math.floor(myIndex / 2); 
  const isTeam1Slot = (myIndex % 2 === 0); // คู่ 0,2,4 -> ลง Team1 / คู่ 1,3,5 -> ลง Team2

  // ดึงแมตช์เป้าหมายในรอบถัดไป (สายเดียวกัน)
  const nextLevelMatches = await Match.find({
    tournamentId: match.tournamentId,
    handLevel: match.handLevel,
    round: nextRound,
    bracketSide: match.bracketSide
  }).sort({ matchNo: 1 });

  const targetMatch = nextLevelMatches[targetIndex];

  if (!targetMatch) {
    console.warn(`Target match not found for Hand: ${match.handLevel}, Round: ${nextRound}, Bracket: ${match.bracketSide}, Index: ${targetIndex}`);
    return;
  }

  // อัปเดตผู้ชนะลงในช่อง
  if (isTeam1Slot) {
    targetMatch.team1 = match.winner;
  } else {
    targetMatch.team2 = match.winner;
  }
  
  // หมายเหตุ: ไม่ต้องเปลี่ยน status เป็น scheduled ซ้ำ หากมันถูกกำหนดไว้แล้ว
  await targetMatch.save();
  console.log(`✅ Auto Advanced: ${match.handLevel} ${match.bracketSide} Winner (${currentRound} #${myIndex}) -> ${nextRound} #${targetIndex} (Slot ${isTeam1Slot ? 1 : 2})`);
}

// ----------------------------------------------------------------------
// 2. Generate Knockout Skeleton (สร้างตารางเปล่า)
// ----------------------------------------------------------------------
async function generateKnockoutSkeleton(tournamentId, handLevel, startMatchNo) {
  const is24Teams = CATEGORIES_24_TEAMS.includes(handLevel);
  
  let roundsToGenerate = [];

  if (is24Teams) {
    // --- กรณี 24 ทีม ---
    roundsToGenerate = [
      { code: "KO16", count: 8 }, // KO16: สายบน 8 คู่ (16 ทีม)
      { code: "QF", count: 8 },   // QF: สายบน 4 คู่ + สายล่าง 4 คู่ (รวม 8 คู่)
      { code: "SF", count: 4 },   // SF: สายบน 2 คู่ + สายล่าง 2 คู่
      { code: "F", count: 2 }     // F:  ชิงบน 1 + ชิงล่าง 1
    ];
  } else {
    // --- กรณี 16 ทีม ---
    roundsToGenerate = [
      { code: "QF", count: 8 },   // QF: บน 4 + ล่าง 4 (แก้ไขจากเดิม 4 เป็น 8)
      { code: "SF", count: 4 },
      { code: "F", count: 2 }
    ];
  }

  let currentMatchNo = startMatchNo;
  const creates = [];

  for (const round of roundsToGenerate) {
    for (let i = 0; i < round.count; i++) {
      const masterOrder = currentMatchNo++;
      const matchId = createKoMatchId(handLevel, round.code, masterOrder, 2);
      
      // Logic ระบุสาย (TOP/BOTTOM)
      let side = "TOP";
      
      if (is24Teams && round.code === "KO16") {
        side = "TOP"; // KO16 มีแต่สายบน
      } else {
        // รอบอื่น แบ่งครึ่งแรกเป็น TOP ครึ่งหลังเป็น BOTTOM
        side = (i < round.count / 2) ? "TOP" : "BOTTOM";
      }

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
        gamesToWin: 2,
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
// 3. Auto Generate from Standings (ดึงทีมลงสาย)
// ----------------------------------------------------------------------
async function autoGenerateKnockoutFromStandings({ tournamentId = "default", handLevel, roundCode }) {
  // ดึงข้อมูลคะแนนและการจัดอันดับ
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

  // --- แยกทีมเข้าสายบน/สายล่าง ---
  if (is24TeamsRule) {
    const rank1s = allTeams.filter(t => t.groupRank === 1);
    const rank2s = allTeams.filter(t => t.groupRank === 2);
    const rank3s = allTeams.filter(t => t.groupRank === 3);
    const rank4s = allTeams.filter(t => t.groupRank === 4);

    rank3s.sort((a, b) => compareStatsOnly(a, b));
    const best3rd = rank3s.slice(0, 4);
    const remaining3rd = rank3s.slice(4);

    upperQualifiers = [...rank1s, ...rank2s, ...best3rd]; // 16 ทีม
    lowerQualifiers = [...remaining3rd, ...rank4s];       // 8 ทีม
  } else {
    upperQualifiers = allTeams.filter(t => t.groupRank <= 2);
    lowerQualifiers = allTeams.filter(t => t.groupRank >= 3);
  }

  // --- จัด Seeding และจับสลาก ---
  // 1. สายบน: ทีมวาง (Seeds) vs ทีมสุ่ม (Non-Seeds)
  upperQualifiers.sort((a, b) => compareStatsOnly(a, b));
  const half = Math.ceil(upperQualifiers.length / 2);
  const seeds = upperQualifiers.slice(0, half);
  const nonSeeds = shuffleArray(upperQualifiers.slice(half));

  // 2. สายล่าง: สุ่มเจอกันหมด
  const lowerShuffled = shuffleArray(lowerQualifiers);

  const updateOps = [];
  let updatedCount = 0;

  // --- ส่วนที่ 1: หยอดทีมสายบน (เข้า KO16 สำหรับ 24 ทีม หรือ QF สำหรับ 16 ทีม) ---
  // ตรวจสอบว่าต้องหยอดลงรอบไหน?
  const upperRoundTarget = is24TeamsRule ? "KO16" : "QF";

  const upperMatches = await Match.find({
    tournamentId, handLevel, roundType: "knockout", round: upperRoundTarget, bracketSide: "TOP"
  }).sort({ matchNo: 1 });

  let uIdx = 0;
  for (let i = 0; i < seeds.length; i++) {
    if (uIdx >= upperMatches.length) break;
    const match = upperMatches[uIdx++];
    const t1 = seeds[i].teamId;
    const t2 = nonSeeds[i] ? nonSeeds[i].teamId : null;
    
    updateOps.push({
      updateOne: { filter: { _id: match._id }, update: { $set: { team1: t1, team2: t2, status: "scheduled" } } }
    });
  }

  // --- ส่วนที่ 2: หยอดทีมสายล่าง (เข้า QF-Bottom สำหรับ 24 ทีม หรือ QF-Bottom สำหรับ 16 ทีม) ---
  // สำหรับ 24 ทีม: สายล่างไปโผล่ที่ QF เลย (ข้าม KO16)
  const lowerRoundTarget = "QF"; 

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

  // Execute Updates
  if (updateOps.length > 0) {
    const res = await Match.bulkWrite(updateOps);
    updatedCount = res.modifiedCount;
  }
  
  // คืนค่าจำนวน Skeleton รวมทุกรอบ เพื่อให้ Frontend รู้
  const totalSkeleton = await Match.countDocuments({ tournamentId, handLevel, roundType: "knockout" });

  return { updatedMatches: updatedCount, totalSkeleton };
}

async function listKnockout() {
  const matches = await Match.find({ tournamentId: "default", roundType: "knockout" })
    .populate("team1", "teamName")
    .populate("team2", "teamName")
    .sort({ round: 1, matchNo: 1 })
    .lean();
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
  advanceKnockoutWinner, // ✅ Export ฟังก์ชันนี้
  listKnockout,
  createKoMatchId
};