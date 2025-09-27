const router = require('express').Router();


// สร้างทีม
router.post('/', async (req, res, next) => {
try {
const {
teamCode,
competitionType,
handLevel,
players,
managerName,
phone,
lineId,
} = req.body;


if (!competitionType || !['Singles', 'Doubles'].includes(competitionType)) {
return res.status(422).json({ message: 'competitionType ต้องเป็น Singles หรือ Doubles' });
}


const level = normalizeHand(handLevel || '');
if (!level) return res.status(422).json({ message: 'handLevel ไม่ถูกต้อง' });


if (!Array.isArray(players) || players.length < 1) {
return res.status(422).json({ message: 'ต้องมีผู้เล่นอย่างน้อย 1 คน' });
}
if (competitionType === 'Doubles' && players.length > 2) {
return res.status(422).json({ message: 'Doubles ได้สูงสุด 2 คน' });
}


// ตรวจผู้เล่นว่ามีอยู่จริงครบ
const found = await Player.find({ _id: { $in: players } }).select('_id');
if (found.length !== players.length) {
return res.status(404).json({ message: 'มี playerId ไม่ถูกต้อง' });
}


// teamCode
let code = (teamCode || '').trim();
if (!code) {
for (let i = 0; i < 5; i++) {
const c = genCode('TM', level.replace(/\s+/g, ''));
const exist = await Team.exists({ teamCode: c });
if (!exist) { code = c; break; }
}
if (!code) throw new Error('Cannot generate unique teamCode');
}


const doc = await Team.create({
teamCode: code,
competitionType,
handLevel: level,
players,
managerName: managerName ? managerName.trim() : undefined,
phone: phone ? phone.trim() : undefined,
lineId: lineId ? lineId.trim() : undefined,
});


return res.status(201).json(doc);
} catch (err) {
return next(err);
}
});


// ดึงทีมทั้งหมด (ล่าสุดก่อน)
router.get('/', async (_req, res, next) => {
try {
const rows = await Team.find().populate('players').sort({ createdAt: -1 });
return res.json(rows);
} catch (err) {
return next(err);
}
});


module.exports = router;