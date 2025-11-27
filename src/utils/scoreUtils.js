// utils/scoreUtils.js

const Team = require("../models/team.model");

// คำนวณคะแนนรวม และเซ็ตที่ชนะจาก sets[]
function calculateSetsAndScores(sets = []) {
  let score1 = 0;
  let score2 = 0;
  let setsWon1 = 0;
  let setsWon2 = 0;

  // 1. แปลงข้อมูลให้เป็นตัวเลขที่ถูกต้องก่อน (Normalize)
  const normalizedSets = (sets || []).map((s) => ({
    t1: Number(s.t1) || 0,
    t2: Number(s.t2) || 0,
  }));

  // 2. คำนวณคะแนน
  normalizedSets.forEach((s) => {
    score1 += s.t1;
    score2 += s.t2;

    if (s.t1 > s.t2) setsWon1 += 1;
    else if (s.t2 > s.t1) setsWon2 += 1;
  });

  // 3. ส่งค่า normalizedSets กลับไปด้วย (สำคัญมาก! ที่ผ่านมาขาดตัวนี้)
  return { 
    score1, 
    score2, 
    setsWon1, 
    setsWon2, 
    normalizedSets // <--- เพิ่มตัวนี้
  };
}

// ตัดสินผลลัพธ์จาก sets + gamesToWin + allowDraw
function decideMatchOutcome({ sets, gamesToWin = 2, allowDraw = false }) {
  const { score1, score2, setsWon1, setsWon2 } = calculateSetsAndScores(sets);

  let outcome = "draw"; 

  if (!allowDraw) {
    if (setsWon1 > setsWon2) outcome = "team1";
    else if (setsWon2 > setsWon1) outcome = "team2";
    else {
      if (score1 > score2) outcome = "team1";
      else if (score2 > score1) outcome = "team2";
      else outcome = "draw";
    }
  } else {
    if (setsWon1 > setsWon2) outcome = "team1";
    else if (setsWon2 > setsWon1) outcome = "team2";
    else outcome = "draw";
  }

  return { outcome, score1, score2, setsWon1, setsWon2 };
}

// สร้าง delta ของสถิติทีม
function buildTeamStatDeltas(match, { outcome, score1, score2, setsWon1, setsWon2 }) {
  const isFinished = match.status === "finished";
  if (!isFinished) return null;

  const team1Id = match.team1;
  const team2Id = match.team2;

  if (!team1Id || !team2Id) return null;

  const base1 = {
    matchesPlayed: 1,
    wins: 0,
    draws: 0,
    losses: 0,
    points: 0,
    setsFor: setsWon1,
    setsAgainst: setsWon2,
    scoreFor: score1,
    scoreAgainst: score2,
  };

  const base2 = {
    matchesPlayed: 1,
    wins: 0,
    draws: 0,
    losses: 0,
    points: 0,
    setsFor: setsWon2,
    setsAgainst: setsWon1,
    scoreFor: score2,
    scoreAgainst: score1,
  };

  // กติกาแต้ม: Win=3, Draw=1, Loss=0
  if (outcome === "team1") {
    base1.wins += 1;
    base1.points += 3;
    base2.losses += 1;
  } else if (outcome === "team2") {
    base2.wins += 1;
    base2.points += 3;
    base1.losses += 1;
  } else {
    // draw
    base1.draws += 1;
    base2.draws += 1;
    base1.points += 1;
    base2.points += 1;
  }

  return { team1Id, team2Id, team1Delta: base1, team2Delta: base2 };
}

// อัปเดต Team (ใช้เฉพาะเมื่อเรียกใช้แยก ไม่ผ่าน route)
async function applyTeamStats(match) {
  const { outcome, score1, score2, setsWon1, setsWon2 } =
    decideMatchOutcome({
      sets: match.sets || [],
      gamesToWin: match.gamesToWin,
      allowDraw: match.allowDraw,
    });

  const delta = buildTeamStatDeltas(match, {
    outcome,
    score1,
    score2,
    setsWon1,
    setsWon2,
  });

  if (!delta) return;

  const { team1Id, team2Id, team1Delta, team2Delta } = delta;

  await Promise.all([
    Team.findByIdAndUpdate(team1Id, { $inc: team1Delta }).exec(),
    Team.findByIdAndUpdate(team2Id, { $inc: team2Delta }).exec(),
  ]);
}

async function revertTeamStats(previousMatch) {
  if (!previousMatch || previousMatch.status !== "finished") return;

  const { outcome, score1, score2, setsWon1, setsWon2 } =
    decideMatchOutcome({
      sets: previousMatch.sets || [],
      gamesToWin: previousMatch.gamesToWin,
      allowDraw: previousMatch.allowDraw,
    });

  const delta = buildTeamStatDeltas(previousMatch, {
    outcome,
    score1,
    score2,
    setsWon1,
    setsWon2,
  });

  if (!delta) return;

  const { team1Id, team2Id, team1Delta, team2Delta } = delta;

  // กลับเครื่องหมายเป็นลบ เพื่อลบค่าออก
  const negate = (obj) => {
    const res = {};
    for (const k in obj) res[k] = -obj[k];
    return res;
  };

  await Promise.all([
    Team.findByIdAndUpdate(team1Id, { $inc: negate(team1Delta) }).exec(),
    Team.findByIdAndUpdate(team2Id, { $inc: negate(team2Delta) }).exec(),
  ]);
}

module.exports = {
  calculateSetsAndScores,
  decideMatchOutcome,
  applyTeamStats,
  revertTeamStats,
};