const router = require('express').Router();
const Team = require('../models/team.model');
const Match = require('../models/match.model');

// Generate groups (simple random split)
router.post('/generate-groups', async (req, res, next) => {
  try {
    const { handLevel, groupNames = ['Group A','Group B'], tournamentId = 'default' } = req.body;
    const teams = await Team.find(handLevel ? { handLevel } : {});
    if (!teams.length) return res.status(400).json({ message: 'No teams to group' });

    // shuffle
    const arr = teams.sort(() => Math.random() - 0.5);
    const groups = groupNames.map(name => ({ name, teams: [] }));
    // round-robin assignment
    arr.forEach((t, i) => groups[i % groups.length].teams.push(t));

    // save group letter on team and create round-robin matches per group
    const createdMatches = [];
    for (const g of groups) {
      const groupLetter = g.name.split(' ').pop(); // e.g., 'A'
      for (const t of g.teams) {
        t.group = groupLetter;
        await t.save();
      }
      // round robin matches: every pair meets once
      for (let i = 0; i < g.teams.length; i++) {
        for (let j = i + 1; j < g.teams.length; j++) {
          const m = await Match.create({
            tournamentId,
            round: `Group ${groupLetter}`,
            team1: g.teams[i]._id,
            team2: g.teams[j]._id,
            status: 'pending'
          });
          createdMatches.push(m);
        }
      }
    }

    res.status(201).json({ groups: groups.map(g => ({ name: g.name, teamCount: g.teams.length })), matches: createdMatches.length });
  } catch (err) {
    next(err);
  }
});

// Generate knockout (seed from top group standings)
router.post('/generate-knockout', async (req, res, next) => {
  try {
    const { groupLetters = ['A','B'], tournamentId = 'default' } = req.body;
    // take top 2 teams from each group by points then scoreDifference
    const byGroup = {};
    for (const letter of groupLetters) {
      const teams = await Team.find({ group: letter }).sort({ points: -1, scoreDifference: -1 }).limit(2);
      byGroup[letter] = teams;
    }

    // Pairing: A1 vs B2, B1 vs A2 (extend as needed)
    const pairs = [];
    if (byGroup['A']?.[0] && byGroup['B']?.[1]) pairs.push([byGroup['A'][0], byGroup['B'][1]]);
    if (byGroup['B']?.[0] && byGroup['A']?.[1]) pairs.push([byGroup['B'][0], byGroup['A'][1]]);

    const created = [];
    for (const [t1, t2] of pairs) {
      const m = await require('../models/match.model').create({
        tournamentId,
        round: 'Quarter-final',
        team1: t1?._id,
        team2: t2?._id,
        status: 'pending'
      });
      created.push(m);
    }
    res.status(201).json({ created: created.length });
  } catch (err) {
    next(err);
  }
});

// Overview (simple)
router.get('/overview', async (_req, res, next) => {
  try {
    const [teamCount, matchCount] = await Promise.all([
      require('../models/team.model').countDocuments(),
      require('../models/match.model').countDocuments()
    ]);
    res.json({ teamCount, matchCount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
