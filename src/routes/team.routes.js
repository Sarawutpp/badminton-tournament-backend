// src/routes/team.routes.js
const router = require('express').Router();
const Player = require('../models/player.model');
const Team = require('../models/team.model');


// CREATE team (พร้อมสร้าง players ถ้าส่งมาด้วย)
router.post('/', async (req, res, next) => {
try {
const { teamName, handLevel, group, players, managerName, tel, lineId, teamCode } = req.body;


let playerIds = [];
if (Array.isArray(players) && players.length) {
const created = await Player.insertMany(players);
playerIds = created.map(p => p._id);
}


// ถ้าไม่ได้ส่ง teamCode มา ให้ gen อัตโนมัติป้องกันชน index
const code = teamCode ?? `TM-${Date.now().toString().slice(-6)}`;


const team = await Team.create({
teamName,
handLevel,
group,
teamCode: code, // ✅ รับค่าเข้าโมเดลจริง ๆ
players: playerIds,
managerName,
tel,
lineId
});


res.status(201).json(team);
} catch (err) {
next(err);
}
});


// LIST Teams
router.get('/', async (_req, res, next) => {
try {
const teams = await Team.find().populate('players').sort({ createdAt: -1 });
res.json(teams);
} catch (err) {
next(err);
}
});


// LIST by group (standings view)
router.get('/group/:name', async (req, res, next) => {
try {
const group = req.params.name;
const teams = await Team.find({ group }).sort({ points: -1, scoreDifference: -1 });
res.json(teams);
} catch (err) {
next(err);
}
});


module.exports = router;