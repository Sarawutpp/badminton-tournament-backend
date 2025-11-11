// backend/scripts/backfill-match-keys.js
const mongoose = require('mongoose');
const Match = require('../models/match.model');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const rows = await Match.find({
      $or: [{ matchId: { $exists: false } }, { order: { $exists: false } }]
    }).sort({ createdAt: 1 });

    let i = 1;
    for (const m of rows) {
      if (!m.order || m.order < 1) m.order = i;
      if (!m.level && m.round && m.round.toUpperCase().includes('GROUP')) {
        // เดา level ถ้ามี — ข้ามได้ถ้าไม่มีข้อมูล
      }
      if (!m.matchId) {
        const lvl = (m.level || 'LV').toUpperCase();
        const grp = (m.group || '-').toUpperCase();
        m.matchId = `${lvl}-${grp}-R1-M${String(i).padStart(2,'0')}`;
      }
      await m.save();
      i++;
    }
    console.log('Backfill done', rows.length);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
