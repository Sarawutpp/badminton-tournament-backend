// migrate.js
require('dotenv').config(); // โหลดค่า .env ถ้ามี
const mongoose = require('mongoose');

// ** แก้ไข Connection String ให้ตรงกับของคุณ **
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/badminton_db"; 

// Import Models (ชี้ Path ให้ถูกตามโครงสร้างโฟลเดอร์คุณ)
// ✅ แก้ Path ให้มี src/ นำหน้า
const Tournament = require('./src/models/tournament.model');
const Team = require('./src/models/team.model');
const Match = require('./src/models/match.model');
const Player = require('./src/models/player.model');

const migrate = async () => {
  try {
    console.log("Connecting to DB...");
    await mongoose.connect(MONGO_URI);
    console.log("Connected.");

    // 1. สร้าง Default Tournament ขึ้นมา 1 อัน เพื่อเป็นตัวแทนข้อมูลเก่า
    let defaultTour = await Tournament.findOne({ name: "Default Tournament" });
    if (!defaultTour) {
      defaultTour = await Tournament.create({
        name: "Default Tournament",
        location: "Unknown",
        dateRange: "2025",
        status: "active",
        settings: {
          maxScore: 21,
          totalCourts: 4,
          rallyPoint: true
        }
      });
      console.log("✅ Created Default Tournament ID:", defaultTour._id);
    } else {
      console.log("ℹ️ Default Tournament already exists ID:", defaultTour._id);
    }

    const tourId = defaultTour._id;

    // 2. อัปเดต Team ทั้งหมด
    // (หาทีมที่ tournamentId ไม่ใช่ ObjectId หรือยังไม่มี field นี้)
    const teams = await Team.find({});
    let teamCount = 0;
    for (const t of teams) {
      // เช็คว่าเป็น ObjectId หรือยัง ถ้ายังให้แก้
      if (!mongoose.Types.ObjectId.isValid(t.tournamentId) || String(t.tournamentId) === 'default') {
        t.tournamentId = tourId;
        await t.save();
        teamCount++;
      }
    }
    console.log(`✅ Migrated ${teamCount} Teams.`);

    // 3. อัปเดต Match ทั้งหมด
    const matches = await Match.find({});
    let matchCount = 0;
    for (const m of matches) {
      if (!mongoose.Types.ObjectId.isValid(m.tournamentId) || String(m.tournamentId) === 'default') {
        m.tournamentId = tourId;
        await m.save();
        matchCount++;
      }
    }
    console.log(`✅ Migrated ${matchCount} Matches.`);

    // 4. อัปเดต Player ทั้งหมด (เพิ่ม tournamentId ให้ผู้เล่นทุกคนไปอยู่ Default)
    const players = await Player.find({ tournamentId: { $exists: false } });
    if (players.length > 0) {
      await Player.updateMany(
        { tournamentId: { $exists: false } },
        { $set: { tournamentId: tourId } }
      );
      console.log(`✅ Migrated ${players.length} Players.`);
    } else {
      console.log("ℹ️ No players needed migration.");
    }

    console.log("🎉 Migration complete! You can now run the server.");
    process.exit(0);

  } catch (err) {
    console.error("❌ Migration Failed:", err);
    process.exit(1);
  }
};

migrate();