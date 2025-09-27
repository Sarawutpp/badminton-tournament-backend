const router = require('express').Router();
const Player = require('../models/player.model');
const { genCode } = require('../utils/codes');


// สร้างผู้เล่น
router.post('/', async (req, res, next) => {
try {
const { playerCode, fullName, nickname, age, lastCompetition, photoUrl } = req.body;


if (!fullName || !fullName.trim()) {
return res.status(422).json({ message: 'fullName จำเป็น' });
}


// สร้าง playerCode ถ้าไม่ส่งมา
let code = (playerCode || '').trim();
if (!code) {
for (let i = 0; i < 5; i++) {
const c = genCode('PL');
const exist = await Player.exists({ playerCode: c });
if (!exist) { code = c; break; }
}
if (!code) throw new Error('Cannot generate unique playerCode');
}


const doc = await Player.create({
playerCode: code,
fullName: fullName.trim(),
nickname: nickname?.trim() || undefined,
age: typeof age === 'number' ? age : (age ? Number(age) : undefined),
lastCompetition: lastCompetition?.trim() || undefined,
photoUrl: photoUrl?.trim() || undefined,
});


res.status(201).json(doc);
} catch (err) { next(err); }
});


// ดึงผู้เล่นทั้งหมด (ล่าสุดก่อน)
router.get('/', async (_req, res, next) => {
try {
const rows = await Player.find().sort({ createdAt: -1 });
res.json(rows);
} catch (err) { next(err); }
});


module.exports = router;