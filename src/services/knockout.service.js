// services/knockout.service.js

const mongoose = require("mongoose");
const Match = require("../models/match.model");
const Team = require("../models/team.model");
const Tournament = require("../models/tournament.model");

// --- Constants & Helpers ---

const ROUND_FLOW = {
  KO32: "KO16",
  KO16: "QF",
  QF: "SF",
  SF: "F",
  F: null,
};

function pad(n, size = 2) {
  return String(n).padStart(size, "0");
}
function upper(s = "") {
  return String(s || "").toUpperCase();
}

function createKoMatchId(handLevel, koCode, masterOrder, padDigits = 2) {
  return `${upper(handLevel)}-${upper(koCode)}-M${pad(masterOrder, padDigits)}`;
}

// ใช้ Comparator ตัวเดียวกับ Tournament Service (Copy มาหรือ Import มาก็ได้ แต่เขียนใหม่เพื่อลด Dependency Loop)
function compareStatsOnly(a, b) {
  // Logic เดียวกับ comparePerformance แต่ไม่ดู Manual Rank เพราะเรากรอง Rank มาแล้ว
  if (b.points !== a.points) return b.points - a.points;
  if (b.setsDiff !== a.setsDiff) return b.setsDiff - a.setsDiff;
  if (b.scoreDiff !== a.scoreDiff) return b.scoreDiff - a.scoreDiff;
  if (b.scoreFor !== a.scoreFor) return b.scoreFor - a.scoreFor;
  return a.teamName.localeCompare(b.teamName);
}

// ----------------------------------------------------------------------
// 1. Placement Logic (การวางตำแหน่งลงแมตช์)
// ----------------------------------------------------------------------
function distributeSeedsToMatches(matches, sortedQualifiers) {
  const matchCount = matches.length;

  // จำนวนทีมวาง = จำนวนคู่ (เช่น 8 คู่ มีทีมวาง 8 ทีม)
  // แต่ถ้าคนแข่งน้อยกว่านั้น ระบบจะตัดเอาเท่าที่มี
  const seedsCount = matchCount;

  // ตัดมาเฉพาะทีมวาง (Seeds)
  const seeds = sortedQualifiers.slice(0, seedsCount);

  // สร้าง Map ว่างๆ ไว้
  const assignmentMap = Array(matchCount)
    .fill(null)
    .map(() => ({ team1: null, team2: null }));

  // --- แผนการวางสาย (Fixed Bracket Seeding) ---
  // Seed 1 อยู่บนสุด, Seed 2 อยู่ล่างสุด
  let seedPositions = [];

  if (matchCount === 8) {
    // Round of 16 (16 Teams)
    seedPositions = [
      { seed: 1, idx: 0, side: "team1" }, // Match 1 (บนสุด)
      { seed: 2, idx: 7, side: "team2" }, // Match 8 (ล่างสุด)
      { seed: 3, idx: 3, side: "team2" },
      { seed: 4, idx: 4, side: "team1" },
      { seed: 5, idx: 1, side: "team2" },
      { seed: 6, idx: 2, side: "team1" },
      { seed: 7, idx: 5, side: "team2" },
      { seed: 8, idx: 6, side: "team1" },
    ];
  } else if (matchCount === 4) {
    // Quarter Finals (8 Teams)
    seedPositions = [
      { seed: 1, idx: 0, side: "team1" },
      { seed: 2, idx: 3, side: "team2" },
      { seed: 3, idx: 1, side: "team2" },
      { seed: 4, idx: 2, side: "team1" },
    ];
  } else if (matchCount === 2) {
    // Semi Finals (4 Teams)
    seedPositions = [
      { seed: 1, idx: 0, side: "team1" },
      { seed: 2, idx: 1, side: "team2" },
    ];
  } else {
    // Fallback
    seedPositions = [
      { seed: 1, idx: 0, side: "team1" },
      { seed: 2, idx: matchCount - 1, side: "team2" },
    ];
  }

  // วางเฉพาะทีมวาง (Seeds)
  seedPositions.forEach((pos) => {
    if (seeds[pos.seed - 1]) {
      assignmentMap[pos.idx][pos.side] = seeds[pos.seed - 1];
    }
  });

  return assignmentMap;
}

// --- Internal: Get Standings ---
async function getStandingsForSeeding(handLevel, tournamentId) {
  if (!tournamentId || !mongoose.Types.ObjectId.isValid(tournamentId))
    return { groups: [] };

  const teams = await Team.find({ handLevel, tournamentId })
    .sort({ group: 1, groupOrder: 1, teamName: 1 })
    .lean();

  const groupsMap = {};
  for (const t of teams) {
    let rawGroup = t.group || "-";
    let groupKey = rawGroup.replace(/[0-9]/g, "").trim();
    if (!groupKey) groupKey = rawGroup;

    if (!groupsMap[groupKey]) groupsMap[groupKey] = [];

    // คำนวณ Stats พื้นฐาน (เผื่อ Team Model ยังไม่อัปเดตล่าสุด)
    const diff = (t.scoreFor || 0) - (t.scoreAgainst || 0);
    const sDiff = (t.setsFor || 0) - (t.setsAgainst || 0);

    groupsMap[groupKey].push({
      teamId: t._id,
      teamName: t.teamName,
      group: groupKey,
      originalGroup: t.group,
      groupRank: 0, // เดี๋ยวคำนวณใหม่
      points: t.points || 0,
      scoreFor: t.scoreFor || 0,
      scoreAgainst: t.scoreAgainst || 0,
      scoreDiff: diff,
      setsFor: t.setsFor || 0,
      setsAgainst: t.setsAgainst || 0,
      setsDiff: sDiff,
      manualRank: t.manualRank || 0,
    });
  }

  const groups = Object.keys(groupsMap)
    .sort()
    .map((groupName) => {
      const list = groupsMap[groupName];
      // ใช้ Logic เดียวกับ Tournament Service เป๊ะๆ
      list.sort((a, b) => {
        const rankA = a.manualRank > 0 ? a.manualRank : 999;
        const rankB = b.manualRank > 0 ? b.manualRank : 999;
        if (rankA !== rankB) return rankA - rankB;
        return compareStatsOnly(a, b);
      });

      list.forEach((t, i) => (t.groupRank = i + 1));
      return { groupName, teams: list };
    });

  return { groups };
}

// ----------------------------------------------------------------------
// Advance Winner
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
    bracketSide: match.bracketSide,
  }).sort({ matchNo: 1 });

  const myIndex = currentLevelMatches.findIndex(
    (m) => String(m._id) === String(match._id)
  );
  if (myIndex === -1) return;

  const targetIndex = Math.floor(myIndex / 2);
  const isTeam1Slot = myIndex % 2 === 0;

  const nextLevelMatches = await Match.find({
    tournamentId: match.tournamentId,
    handLevel: match.handLevel,
    round: nextRound,
    bracketSide: match.bracketSide,
  }).sort({ matchNo: 1 });

  const targetMatch = nextLevelMatches[targetIndex];
  if (!targetMatch) return;

  if (isTeam1Slot) targetMatch.team1 = match.winner;
  else targetMatch.team2 = match.winner;

  await targetMatch.save();
}

// ----------------------------------------------------------------------
// Generate Skeleton
// ----------------------------------------------------------------------
async function generateKnockoutSkeleton(
  tournamentId,
  handLevel,
  startMatchNo,
  groupCount = 4
) {
  if (!tournamentId || !mongoose.Types.ObjectId.isValid(tournamentId))
    throw new Error("Invalid tournamentId");

  const totalTeams = await Team.countDocuments({ tournamentId, handLevel });
  const tour = await Tournament.findById(tournamentId)
    .select("settings")
    .lean();
  const settings = tour?.settings || {};
  const koConfig = settings.matchConfig?.knockoutStage || {};
  const isMini = settings.qualificationType === "MINI_SPLIT";

  const gamesToWin = koConfig.gamesToWin || 2;
  const hasDeuce = koConfig.hasDeuce ?? true;
  const maxScore = koConfig.maxScore || 21;

  // Dynamic Check Model
  const is24TeamsModel = totalTeams > 20 && totalTeams <= 24;

  let roundsToGenerate = [];

  if (is32TeamsModel) {
    // กรณี 32 ทีม: ต้องเจน KO16 จำนวน 16 คู่ (บน 8 / ล่าง 8)
    roundsToGenerate = [
      { code: "KO16", count: 16 },
      { code: "QF", count: 8 },
      { code: "SF", count: 4 },
      { code: "F", count: 2 },
    ];
  } else if (is24TeamsModel || totalTeams > 16) {
    // กรณี 24 ทีม หรือ 16-20 ทีม: ใช้ Logic เดิม
    roundsToGenerate = [
      { code: "KO16", count: 8 },
      { code: "QF", count: 8 }, // ตรงนี้จริงๆ อาจจะเหลือ 4 ได้ถ้าเป็น Knockout ปกติ แต่ถ้าจะเผื่อสายล่างด้วยใช้ 8 ก็ได้ครับ
      { code: "SF", count: 4 },
      { code: "F", count: 2 },
    ];
  } else if (totalTeams > 10) {
    roundsToGenerate = [
      { code: "QF", count: 8 },
      { code: "SF", count: 4 },
      { code: "F", count: 2 },
    ];
  } else if (totalTeams > 4) {
    if (!isMini)
      roundsToGenerate = [
        { code: "QF", count: 4 },
        { code: "SF", count: 2 },
        { code: "F", count: 1 },
      ];
    else
      roundsToGenerate = [
        { code: "SF", count: 4 },
        { code: "F", count: 2 },
      ];
  } else {
    roundsToGenerate = [
      { code: "SF", count: 2 },
      { code: "F", count: 2 },
    ];
  }

  let currentMatchNo = startMatchNo;
  const creates = [];

  for (const round of roundsToGenerate) {
    for (let i = 0; i < round.count; i++) {
      const masterOrder = currentMatchNo++;
      const matchId = createKoMatchId(handLevel, round.code, masterOrder, 2);
      let side = "TOP";

      if (!isMini && totalTeams <= 10 && totalTeams > 4) side = "TOP";
      else if (is24TeamsModel && round.code === "KO16") side = "TOP";
      else side = i < round.count / 2 ? "TOP" : "BOTTOM";

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
        isBye: false,
      });
    }
  }

  if (creates.length > 0) await Match.insertMany(creates);
  return creates.length;
}

// ----------------------------------------------------------------------
// Legacy Support
// ----------------------------------------------------------------------
async function autoGenerateKnockoutFromStandings(params) {
  return await prepareUpperBracketSeeds(params);
}

async function listKnockout(tournamentId) {
  const matches = await Match.find({
    roundType: "knockout",
    ...(tournamentId && { tournamentId }),
  })
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

// ----------------------------------------------------------------------
// 🔥 CORE: Prepare Seeding Logic (หัวใจสำคัญ)
// ----------------------------------------------------------------------
async function prepareUpperBracketSeeds({ tournamentId, handLevel }) {
  const tour = await Tournament.findById(tournamentId)
    .select("settings")
    .lean();
  const settings = tour?.settings || {};
  const isMini = settings.qualificationType === "MINI_SPLIT";

  // 1. ดึงข้อมูลทีม (คำนวณ Rank มาแล้วอย่างถูกต้องจาก Helper)
  const standings = await getStandingsForSeeding(handLevel, tournamentId);
  const groups = standings.groups || [];

  let allTeams = [];
  groups.forEach((g) =>
    g.teams.forEach((t) => allTeams.push({ ...t, groupName: g.groupName }))
  );

  // 2. แยกถัง Rank (เรียงคะแนนเตรียมไว้เลยภายใน Rank นั้นๆ)
  const rank1s = allTeams
    .filter((t) => t.groupRank === 1)
    .sort(compareStatsOnly);
  const rank2s = allTeams
    .filter((t) => t.groupRank === 2)
    .sort(compareStatsOnly);
  const rank3s = allTeams
    .filter((t) => t.groupRank === 3)
    .sort(compareStatsOnly);
  const rank4s = allTeams
    .filter((t) => t.groupRank === 4)
    .sort(compareStatsOnly);

  let finalSeeds = [];
  let finalChallengers = [];

  // ✅ Check Model จากจำนวนกลุ่ม
  const is32Teams = groups.length === 8;
  const is24Teams = groups.length === 6;
  const is16TeamsStandard = groups.length === 4;
  const is8TeamsStandard = !isMini && groups.length === 2;

  // --- LOGIC คัดเลือกทีม (Selection Rule) ---

  if (is32Teams) {
    // 32 Teams (8 Groups) -> 16 Qualifiers
    finalSeeds = [...rank1s]; // Seeds = Rank 1 (8 ทีม)
    finalChallengers = [...rank2s]; // Challengers = Rank 2 (8 ทีม)
  } else if (is24Teams) {
    // 24 Teams (6 Groups) -> 16 Qualifiers
    // Seeds: Rank 1 ทั้งหมด (6) + Rank 2 ที่ดีที่สุด (2)
    // 🔥 บังคับลำดับ: เอา Rank 1 ขึ้นก่อนเสมอ แล้วตามด้วย Rank 2
    const bestRank2s = rank2s.slice(0, 2);
    finalSeeds = [...rank1s, ...bestRank2s];

    // Challengers: Rank 2 ที่เหลือ (4) + Rank 3 ที่ดีที่สุด (4)
    const remainingRank2s = rank2s.slice(2);
    const bestRank3s = rank3s.slice(0, 4);
    finalChallengers = [...remainingRank2s, ...bestRank3s];
  } else if (is16TeamsStandard) {
    // 16 Teams (4 Groups) -> 8 Qualifiers
    finalSeeds = [...rank1s]; // Seeds = Rank 1 (4 ทีม)
    finalChallengers = [...rank2s]; // Challengers = Rank 2 (4 ทีม)
  } else if (is8TeamsStandard) {
    // 8 Teams (2 Groups) -> 8 Qualifiers
    // Seeds: Rank 1 + Rank 2 (เอา Rank 1 ขึ้นก่อนเสมอ)
    finalSeeds = [...rank1s, ...rank2s];

    // Challengers: Rank 3 + Rank 4
    finalChallengers = [...rank3s, ...rank4s];
  } else {
    // Fallback
    finalSeeds = [...rank1s];
    finalChallengers = [...rank2s];
  }

  // 3. สร้าง List ทีมวางที่เรียงลำดับความเก่งแล้ว (Seeds Only Priority)
  // หมายเหตุ: เราจะไม่รวม Challengers ใน Array นี้ เพื่อส่งไปฟังก์ชัน distributeSeedsToMatches
  // เพราะฟังก์ชันนั้นเราแก้ให้รับแค่ Seeds แล้ว
  const seedsForPlacement = [...finalSeeds];

  // 4. หา Match เป้าหมาย (QF หรือ KO16)
  // คำนวณจากจำนวนทีมทั้งหมดที่มีสิทธิ์ (Seeds + Challengers)
  const totalQualified = finalSeeds.length + finalChallengers.length;
  let targetRound = "QF";
  if (totalQualified > 8) {
    targetRound = "KO16";
  } else if (totalQualified <= 4) {
    targetRound = "SF";
  }

  // ดึง Match สายบน (TOP)
  const matches = await Match.find({
    tournamentId,
    handLevel,
    roundType: "knockout",
    round: targetRound,
    bracketSide: "TOP",
  }).sort({ matchNo: 1 });

  if (matches.length === 0)
    return { message: "No matches found in Upper Bracket", targetRound };

  // 5. วางสายลง Match (Distribution)
  // ฟังก์ชันนี้จะวางเฉพาะ Seed 1-N ลงตำแหน่งล็อก และปล่อยช่องอื่นว่างไว้ (null)
  const assignmentMap = distributeSeedsToMatches(matches, seedsForPlacement);

  // 6. Update DB
  const updateOps = [];
  matches.forEach((m, index) => {
    const plan = assignmentMap[index];
    if (!plan) return;

    updateOps.push({
      updateOne: {
        filter: { _id: m._id },
        update: {
          $set: {
            team1: plan.team1 ? plan.team1.teamId : null,
            team2: plan.team2 ? plan.team2.teamId : null,
            status: "scheduled",
          },
        },
      },
    });
  });

  if (updateOps.length > 0) {
    await Match.bulkWrite(updateOps);
  }

  return {
    message: "Seeding completed",
    seedCount: finalSeeds.length,
    challengerCount: finalChallengers.length,
    targetRound,
  };
}

module.exports = {
  generateKnockoutSkeleton,
  autoGenerateKnockoutFromStandings,
  advanceKnockoutWinner,
  listKnockout,
  createKoMatchId,
  prepareUpperBracketSeeds,
};
