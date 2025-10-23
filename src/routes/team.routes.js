const router = require('express').Router();
const Team = require('../models/team.model');
const Player = require('../models/player.model');
const { getNextSequence, pad } = require('../utils/sequence.util');

// ปรับชื่อมือให้เป็นมาตรฐานจากอินพุต
function normalizeHand(input = '') {
  return String(input)
    .replace(/\(.*?\)/g, '')   // ตัด "(..)" ออก เช่น "N (16 ทีม)" -> "N"
    .replace(/^เดี่ยว\s+/, '') // ตัดคำว่า "เดี่ยว "
    .trim()
    .toUpperCase();            // ใช้ตัวใหญ่ทั้งหมด: N/NB/C/BABY...
}

// CREATE team
router.post('/', async (req, res, next) => {
  try {
    const {
      teamCode,            // optional
      teamName,            // required
      competitionType,     // 'Singles' | 'Doubles'
      handLevel,           // N/NB/C/BABY...
      players,             // [playerId...]
      managerName,
      phone,
      lineId,
    } = req.body;

    if (!teamName || !String(teamName).trim()) {
      return res.status(422).json({ message: 'teamName จำเป็น' });
    }
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

    // ตรวจ playerId ว่ามีจริงครบ
    const found = await Player.find({ _id: { $in: players } }).select('_id');
    if (found.length !== players.length) {
      return res.status(404).json({ message: 'มี playerId ไม่ถูกต้อง' });
    }

    // teamCode: <HAND>-NNN (เลขแยกตามมือ)
    let code = (teamCode || '').trim();
    if (!code) {
      const seq = await getNextSequence(`TEAM_${level}`); // key: TEAM_N, TEAM_NB, ...
      code = `${level}-${pad(seq, 3)}`;                   // N-001, NB-012
    } else {
      const exist = await Team.exists({ teamCode: code });
      if (exist) return res.status(409).json({ message: 'teamCode ซ้ำ' });
    }

    const doc = await Team.create({
      teamCode: code,
      teamName: String(teamName).trim(),
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

// LIST teams (?handLevel=...)
router.get('/', async (req, res, next) => {
  try {
    const { handLevel } = req.query;
    const filter = {};
    if (handLevel) filter.handLevel = normalizeHand(handLevel);

    const rows = await Team.find(filter).populate('players').sort({ createdAt: -1 });
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
