const router = require('express').Router();
const Player = require('../models/player.model');
const { getNextSequence, pad } = require('../utils/sequence.util');

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
      const seq = await getNextSequence('PLAYER'); // atomic
      code = `PLR-${pad(seq, 5)}`;                // PLR-00001
    } else {
      // กันซ้ำ
      const exist = await Player.exists({ playerCode: code });
      if (exist) return res.status(409).json({ message: 'playerCode ซ้ำ' });
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
