// utils/scoreUtils.js
const Team = require("../models/team.model");

/**
 * คำนวณคะแนนรวม และเซ็ตที่ชนะ
 * @param {Array} sets - ข้อมูลเซ็ต [{t1: 21, t2: 19}, ...]
 */
function calculateSetsAndScores(sets = []) {
  let score1 = 0;
  let score2 = 0;
  let setsWon1 = 0;
  let setsWon2 = 0;

  const normalizedSets = (sets || []).map((s) => ({
    t1: Number(s.t1) || 0,
    t2: Number(s.t2) || 0,
  }));

  normalizedSets.forEach((s) => {
    score1 += s.t1;
    score2 += s.t2;
    if (s.t1 > s.t2) setsWon1 += 1;
    else if (s.t2 > s.t1) setsWon2 += 1;
  });

  return { score1, score2, setsWon1, setsWon2, normalizedSets };
}

/**
 * ตัดสินผลแพ้ชนะ
 * @param {Object} params - { sets, gamesToWin, allowDraw, maxScore }
 * รองรับ maxScore (แม้ Logic ปัจจุบันจะดูแค่มากกว่าน้อยกว่า แต่เตรียมไว้รองรับกติกา Deuce ในอนาคต)
 */
function decideMatchOutcome({ sets, gamesToWin = 2, allowDraw = false, maxScore }) {
  const { score1, score2, setsWon1, setsWon2 } = calculateSetsAndScores(sets);
  let outcome = "draw";

  // Logic การตัดสิน
  const winThreshold = Number(gamesToWin);
  
  if (!allowDraw) {
    if (setsWon1 > setsWon2) outcome = "team1";
    else if (setsWon2 > setsWon1) outcome = "team2";
    else {
      // กรณีเสมอเซ็ต แต่ไม่ให้เสมอ -> วัดแต้มดิบ (Rally Points)
      if (score1 > score2) outcome = "team1";
      else if (score2 > score1) outcome = "team2";
      else outcome = "draw"; // เสมอจริงๆ (แต้มเท่าเป๊ะ)
    }
  } else {
    if (setsWon1 > setsWon2) outcome = "team1";
    else if (setsWon2 > setsWon1) outcome = "team2";
    else outcome = "draw";
  }

  return { outcome, score1, score2, setsWon1, setsWon2 };
}

/**
 * สร้าง Delta สำหรับอัปเดตสถิติทีม (แยกออกมาเพื่อ Test ง่ายและใช้ซ้ำ)
 * @param {Object} match - Match Document
 * @param {Object} result - ผลลัพธ์จาก decideMatchOutcome
 * @param {Object} rules - กติกาคะแนน { pointsWin, pointsDraw, pointsLose }
 */
function buildTeamStatDeltas(match, { outcome, score1, score2, setsWon1, setsWon2 }, rules) {
  if (match.status !== "finished") return null;
  const { team1: team1Id, team2: team2Id } = match;
  if (!team1Id || !team2Id) return null;

  // ใช้ค่า Default หากไม่มีการส่ง rules มา
  const pWin = rules?.pointsWin ?? 3;
  const pDraw = rules?.pointsDraw ?? 1;
  const pLose = rules?.pointsLose ?? 0;

  const base1 = {
    matchesPlayed: 1, wins: 0, draws: 0, losses: 0, points: 0,
    setsFor: setsWon1, setsAgainst: setsWon2,
    scoreFor: score1, scoreAgainst: score2,
  };

  const base2 = {
    matchesPlayed: 1, wins: 0, draws: 0, losses: 0, points: 0,
    setsFor: setsWon2, setsAgainst: setsWon1,
    scoreFor: score2, scoreAgainst: score1,
  };

  if (outcome === "team1") {
    base1.wins = 1; base1.points = pWin;
    base2.losses = 1; base2.points = pLose;
  } else if (outcome === "team2") {
    base2.wins = 1; base2.points = pWin;
    base1.losses = 1; base1.points = pLose;
  } else {
    base1.draws = 1; base1.points = pDraw;
    base2.draws = 1; base2.points = pDraw;
  }

  return { team1Id, team2Id, team1Delta: base1, team2Delta: base2 };
}

// Helper สำหรับกลับค่าบวกเป็นลบ (Revert)
function negate(obj) {
  const res = {};
  for (const k in obj) res[k] = -obj[k];
  return res;
}

/**
 * Apply Stats (บวกค่า)
 */
async function applyTeamStats(match, rules) {
  const result = decideMatchOutcome({
    sets: match.sets || [],
    gamesToWin: match.gamesToWin,
    allowDraw: match.allowDraw
  });

  const delta = buildTeamStatDeltas(match, result, rules);
  if (!delta) return;

  const { team1Id, team2Id, team1Delta, team2Delta } = delta;
  
  // ใช้ $inc เพื่อ Atomic update
  await Promise.all([
    Team.findByIdAndUpdate(team1Id, { $inc: team1Delta }).exec(),
    Team.findByIdAndUpdate(team2Id, { $inc: team2Delta }).exec(),
  ]);
}

/**
 * Revert Stats (ลบค่า)
 */
async function revertTeamStats(match, rules) {
  const result = decideMatchOutcome({
    sets: match.sets || [],
    gamesToWin: match.gamesToWin,
    allowDraw: match.allowDraw
  });

  const delta = buildTeamStatDeltas(match, result, rules);
  if (!delta) return;

  const { team1Id, team2Id, team1Delta, team2Delta } = delta;

  // กลับเครื่องหมายเพื่อลบค่าออก
  await Promise.all([
    Team.findByIdAndUpdate(team1Id, { $inc: negate(team1Delta) }).exec(),
    Team.findByIdAndUpdate(team2Id, { $inc: negate(team2Delta) }).exec(),
  ]);
}

module.exports = {
  calculateSetsAndScores,
  decideMatchOutcome,
  buildTeamStatDeltas,
  applyTeamStats,
  revertTeamStats
};