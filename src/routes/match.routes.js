// backend/routes/match.routes.js
const router = require('express').Router();
const Match = require('../models/match.model');
const Team = require('../models/team.model');
const mongoose = require('mongoose');

// --- Point system ---
const POINTS_WIN = 2; 
const POINTS_DRAW = 1; 
const POINTS_LOSS_OR_RETIRE = 1; 

// -------- helpers: standings update (ปรับปรุงให้รองรับผลเสมอ) --------
async function revertTeamStats(oldMatch) {
  // (โค้ดส่วนนี้เหมือนเดิม... ไม่ต้องแก้ไข)
  if (!oldMatch || oldMatch.status !== 'finished' || oldMatch.roundType !== 'group') return;
  const [t1, t2] = await Promise.all([
    Team.findById(oldMatch.team1),
    Team.findById(oldMatch.team2),
  ]);
  if (!t1 || !t2) return;
  t1.matchesPlayed = (t1.matchesPlayed || 0) - 1;
  t2.matchesPlayed = (t2.matchesPlayed || 0) - 1;
  t1.scoreFor = (t1.scoreFor || 0) - (oldMatch.score1 || 0);
  t1.scoreAgainst = (t1.scoreAgainst || 0) - (oldMatch.score2 || 0);
  t2.scoreFor = (t2.scoreFor || 0) - (oldMatch.score2 || 0);
  t2.scoreAgainst = (t2.scoreAgainst || 0) - (oldMatch.score1 || 0);
  if (String(oldMatch.winner) === String(t1._id)) {
    t1.wins = (t1.wins || 0) - 1;
    t2.losses = (t2.losses || 0) - 1;
    t1.points = (t1.points || 0) - POINTS_WIN;
    t2.points = (t2.points || 0) - POINTS_LOSS_OR_RETIRE;
  } else if (String(oldMatch.winner) === String(t2._id)) {
    t2.wins = (t2.wins || 0) - 1;
    t1.losses = (t1.losses || 0) - 1;
    t2.points = (t2.points || 0) - POINTS_WIN;
    t1.points = (t1.points || 0) - POINTS_LOSS_OR_RETIRE;
  } else if (!oldMatch.winner) {
    t1.draws = (t1.draws || 0) - 1;
    t2.draws = (t2.draws || 0) - 1;
    t1.points = (t1.points || 0) - POINTS_DRAW;
    t2.points = (t2.points || 0) - POINTS_DRAW;
  }
  t1.scoreDiff = (t1.scoreFor || 0) - (t1.scoreAgainst || 0);
  t2.scoreDiff = (t2.scoreFor || 0) - (t2.scoreAgainst || 0);
  await Promise.all([t1.save(), t2.save()]);
}

async function applyTeamStats(newMatch) {
  // (โค้ดส่วนนี้เหมือนเดิม... ไม่ต้องแก้ไข)
  if (!newMatch || newMatch.status !== 'finished' || newMatch.roundType !== 'group') return;
  const [t1, t2] = await Promise.all([
    Team.findById(newMatch.team1),
    Team.findById(newMatch.team2),
  ]);
  if (!t1 || !t2) return;
  t1.matchesPlayed = (t1.matchesPlayed || 0) + 1;
  t2.matchesPlayed = (t2.matchesPlayed || 0) + 1;
  t1.scoreFor = (t1.scoreFor || 0) + (newMatch.score1 || 0);
  t1.scoreAgainst = (t1.scoreAgainst || 0) + (newMatch.score2 || 0);
  t2.scoreFor = (t2.scoreFor || 0) + (newMatch.score2 || 0);
  t2.scoreAgainst = (t2.scoreAgainst || 0) + (newMatch.score1 || 0);
  if (!t1.wins) t1.wins = 0;
  if (!t1.losses) t1.losses = 0;
  if (!t1.draws) t1.draws = 0;
  if (!t1.points) t1.points = 0;
  if (!t2.wins) t2.wins = 0;
  if (!t2.losses) t2.losses = 0;
  if (!t2.draws) t2.draws = 0;
  if (!t2.points) t2.points = 0;
  if (String(newMatch.winner) === String(t1._id)) {
    t1.wins += 1;
    t2.losses += 1;
    t1.points += POINTS_WIN;
    t2.points += POINTS_LOSS_OR_RETIRE;
  } else if (String(newMatch.winner) === String(t2._id)) {
    t2.wins += 1;
    t1.losses += 1;
    t2.points += POINTS_WIN;
    t1.points += POINTS_LOSS_OR_RETIRE;
  } else if (!newMatch.winner) {
    t1.draws += 1;
    t2.draws += 1;
    t1.points += POINTS_DRAW;
    t2.points += POINTS_DRAW;
  }
  t1.scoreDiff = (t1.scoreFor || 0) - (t1.scoreAgainst || 0);
  t2.scoreDiff = (t2.scoreFor || 0) - (t2.scoreAgainst || 0);
  await Promise.all([t1.save(), t2.save()]);
}

// -------- 1) GET /api/matches (NEW: List/Filter/Page) --------
router.get('/', async (req, res, next) => {
  // (โค้ดส่วนนี้เหมือนเดิม... ไม่ต้องแก้ไข)
  try {
    const {
      page = 1,
      pageSize = 20,
      day,
      handLevel,
      group,
      court,
      status,
      q, 
      sort = 'matchNo', 
      tournamentId,
    } = req.query;

    const query = {};
    const pageNum = parseInt(page, 10) || 1;
    const size = parseInt(pageSize, 10) || 20;
    const skip = (pageNum - 1) * size;

    if (tournamentId) query.tournamentId = tournamentId;
    if (day) query.day = day;
    if (handLevel) query.handLevel = handLevel;
    if (group) query.group = group;
    if (court) query.court = court;
    if (status) query.status = status;

    const sortOrder = {};
    if (sort) {
      const dir = sort.startsWith('-') ? -1 : 1;
      const field = sort.replace(/^-/, '');
      sortOrder[field] = dir;
    } else {
      sortOrder.matchNo = 1; 
    }
    if (!sortOrder.createdAt && !sortOrder._id) sortOrder.createdAt = 1;

    const [items, total] = await Promise.all([
      Match.find(query)
        .populate(['team1', 'team2', 'winner'])
        .sort(sortOrder)
        .skip(skip)
        .limit(size)
        .lean(),
      Match.countDocuments(query)
    ]);

    res.json({
      items,
      total,
      page: pageNum,
      pageSize: size,
    });
  } catch (err) {
    next(err);
  }
});

// -------- 2) PATCH /api/matches/reorder (FIXED: Master List Logic) --------
router.patch('/reorder', async function (req, res, next) {
  // (โค้ดส่วนนี้เหมือนเดิม... ไม่ต้องแก้ไข)
  try {
    const { orderedIds } = req.body;
    
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ message: 'Missing required fields: orderedIds' });
    }

    const operations = orderedIds.map((id, index) => ({
      updateOne: {
        filter: {
          _id: new mongoose.Types.ObjectId(id),
        },
        update: {
          $set: { matchNo: index + 1 } 
        }
      }
    }));

    if (operations.length === 0) {
      return res.json({ updated: 0 });
    }

    const result = await Match.bulkWrite(operations);

    res.json({ updated: result.modifiedCount });
  } catch (err) {
    next(err);
  }
});

// ============ [!! START: ส่วนที่แก้ไข !!] ============

// -------- 3) PUT /api/matches/:id/schedule (FIXED) --------
router.put('/:id/schedule', async (req, res, next) => {
  try {
    // แก้ไข 1: รับ status และ startedAt เพิ่ม
    const { day, scheduledAt, court, matchNo, status, startedAt } = req.body;
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found' });

    const update = {};
    if (day !== undefined) update.day = day;
    if (scheduledAt !== undefined) update.scheduledAt = scheduledAt;
    if (court !== undefined) update.court = court;
    if (matchNo !== undefined) update.matchNo = matchNo;
    if (status !== undefined) update.status = status;         // <-- แก้ไข 2: เพิ่ม status
    if (startedAt !== undefined) update.startedAt = startedAt; // <-- แก้ไข 3: เพิ่ม startedAt

    const updatedMatch = await Match.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true } 
    ).populate(['team1', 'team2', 'winner']);

    res.json(updatedMatch);
  } catch (err) {
    next(err);
  }
});
// ============ [!! END: ส่วนที่แก้ไข !!] ============

// -------- 4) PUT /api/matches/:id/score (NEW) --------
router.put('/:id/score', async (req, res, next) => {
  // (โค้ดส่วนนี้เหมือนเดิม... ไม่ต้องแก้ไข)
  try {
    const { sets, status } = req.body;
    if (!Array.isArray(sets) || !status) {
      return res.status(400).json({ message: 'Missing required fields: sets, status' });
    }

    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found' });

    if (match.status === 'finished' && match.roundType === 'group') {
      await revertTeamStats(match);
    }

    let setsWon1 = 0;
    let setsWon2 = 0;
    let totalGames1 = 0;
    let totalGames2 = 0;

    const validSets = sets.map(s => ({
      t1: parseInt(s.t1, 10) || 0,
      t2: parseInt(s.t2, 10) || 0,
    }));

    for (const s of validSets) {
      totalGames1 += s.t1;
      totalGames2 += s.t2;
      if (s.t1 > s.t2) setsWon1++;
      if (s.t2 > s.t1) setsWon2++;
    }

    let newWinner = null;
    if (status === 'finished') {
      if (match.roundType === 'knockout' || !match.allowDraw) {
        if (setsWon1 >= match.gamesToWin) newWinner = match.team1;
        else if (setsWon2 >= match.gamesToWin) newWinner = match.team2;
      } else {
        if (setsWon1 > setsWon2) newWinner = match.team1;
        else if (setsWon2 > setsWon1) newWinner = match.team2;
      }
    }

    match.sets = validSets;
    match.score1 = totalGames1; 
    match.score2 = totalGames2; 
    match.status = status;
    match.winner = newWinner;

    await match.save();

    if (match.status === 'finished' && match.roundType === 'group') {
      await applyTeamStats(match);
    }

    if (match.status === 'finished' && match.roundType === 'knockout' && match.nextMatchId && match.winner) {
      const next = await Match.findById(match.nextMatchId);
      if (next) {
        if (!next.team1) next.team1 = match.winner;
        else if (!next.team2) next.team2 = match.winner;
        await next.save();
      }
    }

    const populated = await Match.findById(match._id).populate(['team1', 'team2', 'winner']);
    res.json(populated);

  } catch (err) {
    next(err);
  }
});

module.exports = router;