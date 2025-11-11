// scripts/fix_counters_index.js
// ใช้ครั้งเดียวเพื่อย้าย counters จากฟิลด์ "key" -> "_id" (string) และลบ index เก่า "key_1"
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/badtournament'; // แก้ให้ตรงของหมูเด้ง
const DB_NAME = process.env.DB_NAME || ''; // ถ้าใส่ไว้ใน URI แล้ว ปล่อยว่างได้

(async () => {
  try {
    await mongoose.connect(MONGO_URI, {
      dbName: DB_NAME || undefined,
    });
    const db = mongoose.connection.db;
    const counters = db.collection('counters');

    console.log('> Connected. Start migrate counters ...');

    // 1) ลบ index เก่า "key_1" ถ้ามี
    const idx = await counters.indexes();
    const hasKeyIdx = idx.some(i => i.name === 'key_1');
    if (hasKeyIdx) {
      console.log('> Drop index: key_1');
      await counters.dropIndex('key_1');
    } else {
      console.log('> No key_1 index found. skip.');
    }

    // 2) ย้ายเอกสารที่มีฟิลด์ key -> สร้าง doc ใหม่โดยใช้ _id = key, คงค่า seq เดิม
    const cursor = counters.find({ key: { $exists: true } });
    let moved = 0;
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const newId = String(doc.key).trim();
      if (!newId) {
        // ถ้า key ว่าง/ไม่มี ให้ลบฟิลด์ทิ้งเฉย ๆ เพื่อไม่ให้เป็น null ซ้ำ
        await counters.updateOne({ _id: doc._id }, { $unset: { key: "" } });
        continue;
      }
      const seq = typeof doc.seq === 'number' ? doc.seq : 0;

      // upsert เอกสารใหม่ด้วย _id แบบ string
      await counters.updateOne(
        { _id: newId },
        { $set: { _id: newId, seq } },
        { upsert: true }
      );

      // ลบเอกสารเดิม (ที่ _id เป็น ObjectId + มีฟิลด์ key)
      await counters.deleteOne({ _id: doc._id });
      moved++;
    }
    console.log(`> Migrated ${moved} counters.`);

    // 3) เคลียร์ฟิลด์ key ที่อาจตกค้าง
    const unsetRes = await counters.updateMany({ key: { $exists: true } }, { $unset: { key: "" } });
    if (unsetRes.modifiedCount) {
      console.log(`> Unset 'key' on ${unsetRes.modifiedCount} docs.`);
    }

    console.log('> Done. You can restart backend now.');
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('x Error:', err);
    process.exit(1);
  }
})();
