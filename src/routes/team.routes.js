const router = require('express').Router();
const Team = require('../models/team.model');
const Player = require('../models/player.model');
const { genCode } = require('../utils/codes');

function normalizeHand(input = '') {
  return String(input)
    .replace(/\(.*?\)/g, '')
    .replace(/^เดี่ยว\s+/, '')
    .replace('BG (Mixs)', 'Mix')
    .trim();
}

// CREATE team
router.post('/', async (req, res, next) => {
  try {
    const {
      teamCode,
      teamName,            // 👈 รับชื่อทีม
      competitionType,
      handLevel,
      players,
      managerName,
      phone,
      lineId,
    } = req.body;

    if (!teamName || !String(teamName).trim()) {
      return res.status(422).json({ message: 'teamName จำเป็น' });
    }
    if (!competitionType || !['Singles','Doubles'].includes(competitionType)) {
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

    // ตรวจ playerId ว่ามีจริงครบ
    const found = await Player.find({ _id: { $in: players } }).select('_id');
    if (found.length !== players.length) {
      return res.status(404).json({ message: 'มี playerId ไม่ถูกต้อง' });
    }

    // teamCode อัตโนมัติถ้าไม่ได้ส่งมา
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
      teamName: String(teamName).trim(),  // 👈 บันทึกชื่อทีม
      competitionType,
      handLevel: level,
      players,
      managerName: managerName ? String(managerName).trim() : undefined,
      phone: phone ? String(phone).trim() : undefined,
      lineId: lineId ? String(lineId).trim() : undefined,
    });

    return res.status(201).json(doc);
  } catch (err) {
    return next(err);
  }
});

// LIST teams (ล่าสุดก่อน)
router.get('/', async (_req, res, next) => {
  try {
    const rows = await Team.find().populate('players').sort({ createdAt: -1 });
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
