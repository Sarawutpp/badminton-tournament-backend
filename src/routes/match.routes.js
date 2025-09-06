const router = require('express').Router();
const Match = require('../models/match.model');
const Team = require('../models/team.model');

// Get matches by round (e.g., Group A)
router.get('/', async (req, res, next) => {
  try {
    const { round } = req.query;
    const q = round ? { round } : {};
    const matches = await Match.find(q).populate(['team1','team2','winner']).sort({ order: 1, createdAt: 1 });
    res.json(matches);
  } catch (err) {
    next(err);
  }
});

// Update result
router.put('/:id', async (req, res, next) => {
  try {
    const { score1, score2, games, status } = req.body;
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ message: 'Match not found' });

    match.score1 = score1 ?? match.score1;
    match.score2 = score2 ?? match.score2;
    match.games = Array.isArray(games) ? games : match.games;
    match.status = status ?? 'finished';

    let winnerId = null;
    if (typeof match.score1 === 'number' && typeof match.score2 === 'number') {
      winnerId = match.score1 > match.score2 ? match.team1 : (match.score2 > match.score1 ? match.team2 : null);
    }
    match.winner = winnerId;

    await match.save();

    // Update standings if this is a group match: round like 'Group X'
    const isGroup = /^Group\s+/i.test(match.round);
    if (isGroup && winnerId) {
      const loserId = String(winnerId) === String(match.team1) ? match.team2 : match.team1;
      const [winner, loser] = await Promise.all([Team.findById(winnerId), Team.findById(loserId)]);
      const diff = Math.abs((match.score1 || 0) - (match.score2 || 0));

      winner.matchesPlayed += 1;
      loser.matchesPlayed += 1;
      winner.wins += 1;
      loser.losses += 1;
      winner.points += 2; // win = 2
      loser.points += 1;  // lose = 1
      winner.scoreDifference += diff;
      loser.scoreDifference -= diff;
      await Promise.all([winner.save(), loser.save()]);
    }

    // Push winner to next match if knockout
    if (!isGroup && match.nextMatchId && winnerId) {
      const next = await Match.findById(match.nextMatchId);
      if (next) {
        // Place winner into empty slot
        if (!next.team1) next.team1 = winnerId;
        else if (!next.team2) next.team2 = winnerId;
        await next.save();
      }
    }

    const populated = await Match.findById(match._id).populate(['team1','team2','winner']);
    res.json(populated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
