// services/tournament.service.js  (เวอร์ชันปรับปรุง)
const mongoose = require("mongoose");
const Team = require("../models/team.model");
const Match = require("../models/match.model");

// ---------- helpers ----------
function pad(n, size = 2) { return String(n).padStart(size, "0"); }
function upper(s = "") { return String(s || "").toUpperCase(); }
function oid(x) { return typeof x === "string" ? new mongoose.Types.ObjectId(x) : x; }
function normLetter(s = "") {
  const m = String(s).match(/Group\s+([A-Z])/i);
  return (m ? m[1] : String(s).slice(-1)).toUpperCase();
}

// เดิม: HAND-GROUP-Mxxx  (ไม่มีรอบ)
// ใหม่: รองรับทั้ง Group และ Knockout
function createGroupMatchId(handLevel, groupLetter, roundNo, masterOrder, padDigits = 2) {
  return `${upper(handLevel)}-${upper(groupLetter)}-R${roundNo}-M${pad(masterOrder, padDigits)}`;
}
function createKoMatchId(handLevel, koCode, masterOrder, padDigits = 2) {
  return `${upper(handLevel)}-${upper(koCode)}-M${pad(masterOrder, padDigits)}`;
}

/** จัดรอบแบบ Round-Robin เป็น “รอบ” (R1, R2, ...) คืนค่า [{roundNo, pairs:[{t1,t2},...]}, ...] */
function buildRoundRobinRounds(teamIds = []) {
  const ids = teamIds.map(oid).slice();
  if (ids.length < 2) return [];
  const even = ids.length % 2 === 0;
  if (!even) ids.push(null); // ใส่ BYE ถ้าจำนวนทีมเป็นคี่

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
    // หมุนแบบ circle method (ล็อกตำแหน่งตัวแรกไว้)
    const fixed = arr[0];
    const rotated = [fixed, ...arr.slice(2), arr[1]];
    arr = rotated;
  }
  return out;
}

/**
 * ยอมรับ groups ได้หลายทรง แล้วแปลงเป็นมาตรฐาน:
 *   [{ letter:'A', teamIds:[ObjectId,...] }, ...]
 */
async function normalizeGroupsPayload(body) {
  const { handLevel } = body || {};
  let groups = body?.groups;

  // object map { "A":[ids], "B":[ids] }
  if (groups && !Array.isArray(groups) && typeof groups === "object") {
    const out = [];
    for (const [k, arr] of Object.entries(groups)) {
      out.push({ letter: normLetter(k), teamIds: (arr || []).map(oid) });
    }
    return out;
  }

  // array [{letter/teamIds}] หรือ [{name/teams}] หรือ [{group/teams}]
  if (Array.isArray(groups) && groups.length) {
    return groups
      .map((g) => ({
        letter: normLetter(g.letter || g.name || g.group || ""),
        teamIds: (g.teamIds || g.teams || []).map((t) => oid(t?._id || t)),
      }))
      .filter((g) => g.letter && g.teamIds.length);
  }

  // fallback: ดึงจาก Team ตาม handLevel
  if (handLevel) {
    const teams = await Team.find({ handLevel }).select("_id group").lean();
    const bucket = {};
    for (const t of teams) {
      const L = normLetter(t.group || "");
      if (!L) continue;
      if (!bucket[L]) bucket[L] = [];
      bucket[L].push(t._id);
    }
    return Object.entries(bucket).map(([L, ids]) => ({ letter: L, teamIds: ids }));
  }

  return [];
}

// ---------- services ----------

/**
 * Manual grouping + generate round-robin matches (เป็นรอบ R1..Rk + Match ID ใหม่)
 * body:
 *  - { handLevel, groups:{ A:[...], B:[...] } } (แนะนำ)
 *  - หรือรูปแบบอื่นที่ normalizeGroupsPayload รองรับ
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
  if (!normGroups.length) {
    throw new Error("groups is required (non-empty)");
  }

  // ลบแมตช์เก่าของ level นี้ในรอบแบ่งกลุ่ม
  await Match.deleteMany({
    tournamentId,
    handLevel,
    roundType: "group",
  });

  // sync group ลง Team
  for (const g of normGroups) {
    await Team.updateMany({ _id: { $in: g.teamIds } }, { $set: { group: g.letter } });
  }

  // สร้าง RR แบบเป็น “รอบ”
  let created = 0;
  let runningOrder = 1;

  for (const g of normGroups) {
    const rounds = buildRoundRobinRounds(g.teamIds); // [{roundNo, pairs:[...]}]
    for (const R of rounds) {
      const roundNo = R.roundNo; // 1-based
      for (const p of R.pairs) {
        const order = runningOrder++;
        const matchId = createGroupMatchId(handLevel, g.letter, roundNo, order, 2);
        await Match.create({
          tournamentId,
          roundType: "group",
          handLevel,
          group: g.letter,
          round: `Group ${g.letter}`,
          groupRound: roundNo,              // <-- ใส่รอบ R1/R2/R3
          matchNo: order,                   // <-- Master order ต่อเนื่องทั้งทุกกลุ่ม
          matchId,                          // <-- ฟอร์แมตใหม่ HAND-G-RX-Mxx
          team1: p.t1,
          team2: p.t2,
          gamesToWin,
          allowDraw,
          score1: 0,
          score2: 0,
          status: "scheduled",
        });
        created++;
      }
    }
  }

  return {
    level: handLevel,
    groups: normGroups.map((g) => ({ letter: g.letter, teamCount: g.teamIds.length })),
    matches: created,
    createdMatches: created, // เพื่อให้ Generator.jsx แจ้งจำนวนคู่ได้ถูกต้อง
  };
}

/**
 * สุ่ม RR (ยังคงไว้กรณีใช้งานเดิม) — ปรับ Match ID ให้ใช้ตัวพิมพ์ใหญ่ และเติม groupRound=?
 * หมายเหตุ: ถ้าต้องการฟอร์แมต R1/R2 ที่เป๊ะ แนะนำใช้ manualGroupAndGenerate แทน
 */
async function generateMatches(handLevel, strategy, teamsPerGroup = 4) {
  if (!handLevel) throw new Error("handLevel is required");

  const teams = await Team.find({ tournamentId: "default", handLevel }).lean();
  if (!teams || teams.length < 2) {
    throw new Error(`No teams found for level ${handLevel}. (Found ${teams ? teams.length : 0})`);
  }

  const { deletedCount: deletedMatches } = await Match.deleteMany({
    tournamentId: "default",
    handLevel,
  });

  let matchesCreated = 0;
  let groupsCreated = 0;

  if (strategy === "RR") {
    const shuffledTeams = teams.sort(() => 0.5 - Math.random());
    const numGroups = Math.ceil(shuffledTeams.length / teamsPerGroup);
    groupsCreated = numGroups;

    const creates = [];
    let matchNoCounter = 1;

    for (let i = 0; i < numGroups; i++) {
      const groupName = String.fromCharCode(65 + i); // A, B, C...
      const groupTeams = shuffledTeams.slice(i * teamsPerGroup, (i + 1) * teamsPerGroup);

      await Team.updateMany(
        { _id: { $in: groupTeams.map((t) => t._id) } },
        { $set: { group: groupName } }
      );

      // ใช้ round-robin แบบเป็นรอบ
      const rounds = buildRoundRobinRounds(groupTeams.map((t) => t._id));
      for (const R of rounds) {
        for (const p of R.pairs) {
          const currentMatchNo = matchNoCounter++;
          const matchId = createGroupMatchId(handLevel, groupName, R.roundNo, currentMatchNo, 2);
          creates.push(
            Match.create({
              tournamentId: "default",
              roundType: "group",
              handLevel,
              group: groupName,
              round: `Group ${groupName}`,
              groupRound: R.roundNo,
              matchNo: currentMatchNo,
              matchId,
              team1: p.t1,
              team2: p.t2,
              gamesToWin: 2,
              allowDraw: false,
              score1: 0,
              score2: 0,
              status: "scheduled",
            })
          );
        }
      }
    }

    await Promise.all(creates);
    matchesCreated = creates.length;
  } else {
    throw new Error("Unknown strategy");
  }

  return { handLevel, teamsFound: teams.length, deletedMatches, groupsCreated, matchesCreated };
}

async function listAllMatches() {
  const matches = await Match.find({ tournamentId: "default" })
    .populate("team1", "teamName")
    .populate("team2", "teamName")
    .sort({ matchNo: 1 })
    .lean();
  return matches;
}

async function listSchedule(
  page = 1,
  pageSize = 20,
  handLevel = "",
  status = "",
  q = "",
  sort = "matchNo"
) {
  const query = { tournamentId: "default" };
  if (handLevel) query.handLevel = handLevel;
  if (status) query.status = status;
  if (q) query.matchId = { $regex: q, $options: "i" };

  const skip = (page - 1) * pageSize;
  const [total, items] = await Promise.all([
    Match.countDocuments(query),
    Match.find(query)
      .populate("team1", "teamName players")
      .populate("team2", "teamName players")
      .sort(sort)
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

async function updateScore(matchId, scoreData) {
  const { sets = [], status = "finished" } = scoreData;

  let score1 = 0;
  let score2 = 0;
  let setsWon1 = 0;
  let setsWon2 = 0;

  const normSets = sets.map((s) => ({
    t1: parseInt(s.t1 || 0, 10),
    t2: parseInt(s.t2 || 0, 10),
  }));
  normSets.forEach((s) => {
    score1 += s.t1;
    score2 += s.t2;
    if (s.t1 > s.t2) setsWon1++;
    else if (s.t2 > s.t1) setsWon2++;
  });

  const match = await Match.findById(matchId);
  if (!match) throw new Error("Match not found");

  let winner = null;
  if (status === "finished") {
    if (match.roundType === "knockout" || !match.allowDraw) {
      if (setsWon1 >= (match.gamesToWin || 2)) winner = match.team1;
      else if (setsWon2 >= (match.gamesToWin || 2)) winner = match.team2;
    } else {
      if (setsWon1 > setsWon2) winner = match.team1;
      else if (setsWon2 > setsWon1) winner = match.team2;
    }
  }

  match.sets = normSets;
  match.score1 = score1;
  match.score2 = score2;
  match.status = status;
  match.winner = winner;
  await match.save();

  return await Match.findById(match._id).populate(["team1", "team2", "winner"]);
}

async function reorderMatches(orderedIds = []) {
  const bulkOps = orderedIds.map((id, index) => ({
    updateOne: { filter: { _id: id }, update: { $set: { matchNo: index + 1 } } },
  }));
  if (bulkOps.length === 0) return { updated: 0 };
  const result = await Match.bulkWrite(bulkOps);
  return { updated: result.modifiedCount || 0 };
}

async function getStandings(handLevel) {
  const teams = await Team.find({ tournamentId: "default", handLevel })
    .sort({ group: 1, teamName: 1 })
    .lean();

  const matches = await Match.find({
    tournamentId: "default",
    handLevel,
    status: "finished",
  }).lean();

  const teamMap = {};
  teams.forEach((t) => {
    teamMap[t._id] = {
      ...t,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      points: 0,
      scoreFor: 0,
      scoreAgainst: 0,
      scoreDiff: 0,
    };
  });

  matches.forEach((m) => {
    const t1 = teamMap[m.team1];
    const t2 = teamMap[m.team2];
    if (!t1 || !t2) return;

    const s1 = m.score1 || 0;
    const s2 = m.score2 || 0;

    t1.matchesPlayed++;
    t2.matchesPlayed++;
    t1.scoreFor += s1;
    t1.scoreAgainst += s2;
    t2.scoreFor += s2;
    t2.scoreAgainst += s1;

    if (s1 > s2) {
      t1.wins++; t1.points += 2;
      t2.losses++; t2.points += 1;
    } else if (s2 > s1) {
      t2.wins++; t2.points += 2;
      t1.losses++; t1.points += 1;
    } else {
      t1.draws++; t2.draws++;
      t1.points += 1; t2.points += 1;
    }
  });

  const groups = {};
  Object.values(teamMap).forEach((t) => {
    t.scoreDiff = t.scoreFor - t.scoreAgainst;
    const g = t.group || "N/A";
    if (!groups[g]) groups[g] = [];
    groups[g].push(t);
  });

  const resultGroups = Object.keys(groups)
    .sort()
    .map((groupName) => {
      const sorted = groups[groupName].sort(
        (a, b) =>
          (b.points ?? 0) - (a.points ?? 0) ||
          (b.scoreDiff ?? 0) - (a.scoreDiff ?? 0) ||
          (b.wins ?? 0) - (a.wins ?? 0) ||
          (b.scoreFor ?? 0) - (a.scoreFor ?? 0)
      );
      return { groupName, teams: sorted };
    });

  return { level: handLevel, groups: resultGroups };
}

/** (แถม) สร้าง Knockout รอบใด ๆ พร้อมรีเซ็ต matchNo เริ่ม 1 ใหม่ และ Match ID แบบ KOcode */
async function generateKnockout({
  tournamentId = "default",
  handLevel,
  koCode = "KO16",         // เช่น "KO16", "QF", "SF", "F"
  pairs = [],              // [{t1:ObjectId, t2:ObjectId}, ...] เรียงลำดับมาแล้ว
  gamesToWin = 2,
}) {
  if (!handLevel) throw new Error("handLevel is required");
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new Error("pairs is required (non-empty)");
  }

  // ลบ KO เดิมของ koCode นี้ (ถ้าต้องการเฉพาะรอบ ให้ใส่ตัวกรอง round=koCode)
  await Match.deleteMany({
    tournamentId,
    handLevel,
    roundType: "knockout",
    round: koCode,
  });

  const creates = [];
  for (let i = 0; i < pairs.length; i++) {
    const masterOrder = i + 1; // Reset ใหม่
    const matchId = createKoMatchId(handLevel, koCode, masterOrder, 2);
    creates.push(
      Match.create({
        tournamentId,
        roundType: "knockout",
        handLevel,
        round: koCode,      // เช่น "KO16"
        matchNo: masterOrder,
        matchId,
        team1: oid(pairs[i].t1),
        team2: oid(pairs[i].t2),
        gamesToWin,
        allowDraw: false,
        score1: 0,
        score2: 0,
        status: "scheduled",
      })
    );
  }
  await Promise.all(creates);
  return { createdMatches: creates.length };
}

async function listKnockout() {
  const matches = await Match.find({
    tournamentId: "default",
    roundType: "knockout",
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

module.exports = {
  // เดิมคง export createMatchId เพื่อ compat (ถ้าตัวอื่นอ้างถึง)
  // แต่ภายในไฟล์นี้เราใช้ createGroupMatchId / createKoMatchId แทน
  createMatchId: (hand, part, order, padDigits = 2) =>
    `${upper(hand)}-${upper(part)}-M${pad(order, padDigits)}`,
  manualGroupAndGenerate,
  generateMatches,
  listAllMatches,
  listSchedule,
  updateSchedule,
  updateScore,
  reorderMatches,
  getStandings,
  listKnockout,
  generateKnockout,
};
