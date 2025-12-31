// services/tournament.service.js
const mongoose = require("mongoose");
const Team = require("../models/team.model");
const Match = require("../models/match.model");
const Tournament = require("../models/tournament.model");
const knockoutService = require("./knockout.service");

// --- Helpers ---
function pad(n, size = 2) {
  return String(n).padStart(size, "0");
}
function upper(s = "") {
  return String(s || "").toUpperCase();
}
function oid(x) {
  return typeof x === "string" ? new mongoose.Types.ObjectId(x) : x;
}
function normLetter(s = "") {
  const m = String(s).match(/Group\s+([A-Z])/i);
  return (m ? m[1] : String(s).slice(-1)).toUpperCase();
}
function createGroupMatchId(
  handLevel,
  groupLetter,
  roundNo,
  masterOrder,
  padDigits = 2
) {
  return `${upper(handLevel)}-${upper(groupLetter)}-R${roundNo}-M${pad(
    masterOrder,
    padDigits
  )}`;
}

// Helper: Fetch Tournament Settings
async function getTournamentConfig(tournamentId) {
  const tour = await Tournament.findById(tournamentId).lean();
  if (!tour) throw new Error("Tournament not found");

  return {
    rules: tour.rules || { pointsWin: 3, pointsDraw: 1, pointsLose: 0 },
    settings: tour.settings || {
      maxScore: 21,
      totalCourts: 4,
      categories: [],
      rallyPoint: true,
    },
  };
}

// ✅ STANDARD COMPARATOR: ใช้เป็นมาตรฐานเดียวกันทั้งระบบ
function comparePerformance(a, b) {
  // 1. Manual Rank (ถ้ามีการจัดอันดับด้วยมือ)
  const rankA = a.manualRank && a.manualRank > 0 ? a.manualRank : 999;
  const rankB = b.manualRank && b.manualRank > 0 ? b.manualRank : 999;
  if (rankA !== rankB) return rankA - rankB;

  // 2. คะแนน (มากไปน้อย)
  if (b.points !== a.points) return b.points - a.points;
  // 3. ผลต่างเซต (มากไปน้อย)
  if (b.setsDiff !== a.setsDiff) return b.setsDiff - a.setsDiff;
  // 4. ผลต่างแต้ม (มากไปน้อย)
  if (b.scoreDiff !== a.scoreDiff) return b.scoreDiff - a.scoreDiff;
  // 5. แต้มได้ (มากไปน้อย)
  if (b.scoreFor !== a.scoreFor) return b.scoreFor - a.scoreFor;
  // 6. ชื่อทีม (ก-ฮ)
  return a.teamName.localeCompare(b.teamName);
}

// Helper: Round Robin Pairs
function buildRoundRobinRounds(teamIds = []) {
  const ids = teamIds.map(oid).slice();
  if (ids.length < 2) return [];
  const even = ids.length % 2 === 0;
  if (!even) ids.push(null);
  const n = ids.length;
  const rounds = n - 1;
  let arr = ids.slice();
  const out = [];

  for (let r = 1; r <= rounds; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a && b) pairs.push({ t1: a, t2: b });
    }
    out.push({ roundNo: r, pairs });
    arr = [arr[0], ...arr.slice(2), arr[1]];
  }
  return out;
}

// ----------------------------------------------------------------------
// CORE SERVICES
// ----------------------------------------------------------------------

async function manualGroupAndGenerate(body) {
  const { tournamentId, handLevel } = body || {};
  if (!handLevel) throw new Error("handLevel is required");
  if (!tournamentId) throw new Error("tournamentId is required");

  // 1. ดึง Config จาก DB
  const { settings } = await getTournamentConfig(tournamentId);
  const groupConfig = settings?.matchConfig?.groupStage || {};

  const gamesToWin = groupConfig.gamesToWin || 2;
  const maxScore = groupConfig.maxScore || 21;
  const hasDeuce = groupConfig.hasDeuce ?? true;
  const allowDraw = groupConfig.allowDraw ?? gamesToWin === 2;

  let groups = body.groups;
  if (groups && !Array.isArray(groups) && typeof groups === "object") {
    const out = [];
    for (const [k, arr] of Object.entries(groups)) {
      out.push({ letter: normLetter(k), teamIds: (arr || []).map(oid) });
    }
    groups = out;
  }
  if (!groups || !groups.length) throw new Error("groups is required");

  await Match.deleteMany({ tournamentId, handLevel });

  for (const g of groups) {
    await Team.updateMany(
      { _id: { $in: g.teamIds } },
      { $set: { group: g.letter } }
    );
  }

  let createdGroups = 0;
  let runningOrder = 1;

  for (const g of groups) {
    const rounds = buildRoundRobinRounds(g.teamIds);
    for (const R of rounds) {
      for (const p of R.pairs) {
        const order = runningOrder++;
        const matchId = createGroupMatchId(
          handLevel,
          g.letter,
          R.roundNo,
          order,
          2
        );

        await Match.create({
          tournamentId,
          roundType: "group",
          handLevel,
          group: g.letter,
          round: `Group ${g.letter}`,
          groupRound: R.roundNo,
          matchNo: order,
          matchId,
          team1: p.t1,
          team2: p.t2,
          gamesToWin,
          maxScore,
          allowDraw,
          hasDeuce,
          status: "scheduled",
        });
        createdGroups++;
      }
    }
  }

  const createdKnockouts = await knockoutService.generateKnockoutSkeleton(
    tournamentId,
    handLevel,
    runningOrder,
    groups.length
  );

  return {
    level: handLevel,
    groups: groups.map((g) => ({
      letter: g.letter,
      teamCount: g.teamIds.length,
    })),
    matches: createdGroups,
    knockoutMatches: createdKnockouts,
    totalMatches: createdGroups + createdKnockouts,
  };
}

async function getStandings(handLevel, tournamentId) {
  if (!handLevel) throw new Error("handLevel is required");

  const query = { handLevel };
  if (tournamentId) query.tournamentId = tournamentId;

  const teams = await Team.find(query)
    .populate("players", "fullName nickname")
    .lean(); // ไม่ Sort ตรงนี้ เดี๋ยวไป Sort ใน JS เพื่อความชัวร์

  const groupsMap = {};
  for (const t of teams) {
    const groupName = t.group || "-";
    if (!groupsMap[groupName]) groupsMap[groupName] = [];

    const diff = (Number(t.scoreFor) || 0) - (Number(t.scoreAgainst) || 0);
    const sDiff = (Number(t.setsFor) || 0) - (Number(t.setsAgainst) || 0);

    groupsMap[groupName].push({
      ...t,
      scoreDiff: diff,
      setsDiff: sDiff,
      manualRank: t.manualRank || 0,
    });
  }

  // จัดเรียงและใส่ Rank
  const groups = Object.keys(groupsMap)
    .sort()
    .map((groupName) => {
      const list = groupsMap[groupName];

      // 1. เรียงตามคะแนนความเก่ง (Standard Logic)
      list.sort((a, b) => comparePerformance(a, b));

      // 2. Assign Group Rank (1, 2, 3...)
      list.forEach((t, i) => {
        t.groupRank = i + 1;
      });

      return { groupName, teams: list };
    });

  return { handLevel, tournamentId, groups };
}

module.exports = {
  manualGroupAndGenerate,
  getStandings,
  getTournamentConfig,
  createGroupMatchId,
  comparePerformance, // Export ไปให้ Knockout Service ใช้ด้วยจะได้มาตรฐานเดียว
};
