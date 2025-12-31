// routes/team.routes.js
const express = require("express");
const router = express.Router();
const multer = require("multer"); // [NEW] Import multer
const path = require("path");     // [NEW] Import path
const fs = require("fs");         // [NEW] Import fs
const Team = require("../models/team.model");
const Player = require("../models/player.model");
const { authMiddleware, requireAdmin } = require("./auth.routes");

// ==========================================
// 1. Config Multer สำหรับอัปโหลดรูป
// ==========================================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "uploads/";
    // สร้างโฟลเดอร์ uploads ถ้ายังไม่มี
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // ตั้งชื่อไฟล์: team-{id}-{timestamp}.นามสกุล
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      "team-" + req.params.id + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const upload = multer({ storage: storage });

// ==========================================
// 2. Routes
// ==========================================

// [NEW] Route อัปโหลดรูปทีม
// POST /api/teams/:id/upload-photo
router.post(
  "/:id/upload-photo",
  authMiddleware,
  requireAdmin,
  upload.single("photo"), // รับไฟล์ชื่อ field 'photo'
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // สร้าง URL (สมมติว่า backend serve folder uploads ไว้ที่ root)
      const photoUrl = `/uploads/${req.file.filename}`;

      // อัปเดตข้อมูลทีม
      const updatedTeam = await Team.findByIdAndUpdate(
        req.params.id,
        { teamPhotoUrl: photoUrl },
        { new: true }
      );

      if (!updatedTeam) {
        return res.status(404).json({ message: "Team not found" });
      }

      res.json({
        success: true,
        message: "Upload successful",
        teamPhotoUrl: photoUrl,
        team: updatedTeam,
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);
router.post("/import-bulk", authMiddleware, requireAdmin, async (req, res) => {
  const { tournamentId, data } = req.body; 
  // data คาดหวังรูปแบบ: [{ teamName, handLevel, players: [{fullName, nickname}, ...] }]

  if (!Array.isArray(data) || data.length === 0) {
    return res.status(400).json({ message: "Invalid data format" });
  }

  try {
    const results = [];
    const errors = [];

    for (const item of data) {
      try {
        // 1. ตรวจสอบหรือสร้างผู้เล่น (Check or Create Players)
        const playerIds = [];
        
        for (const p of item.players) {
          if (!p.fullName) continue;

          // ค้นหาว่ามีชื่อนี้ในรายการนี้หรือยัง
          let player = await Player.findOne({ 
            fullName: p.fullName.trim(),
            tournamentId: tournamentId || "default"
          });

          // ถ้าไม่มี ให้สร้างใหม่
          if (!player) {
            player = new Player({
              tournamentId: tournamentId || "default",
              playerCode: `PL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, // Gen Code ชั่วคราว
              fullName: p.fullName.trim(),
              nickname: p.nickname ? p.nickname.trim() : "",
              age: 0 
            });
            await player.save();
          }
          playerIds.push(player._id);
        }

        // 2. สร้างทีม (Create Team)
        // สร้าง Team Code (ใช้ฟังก์ชัน generateTeamCode ที่มีอยู่แล้วในไฟล์เดิม)
        const teamCode = generateTeamCode(item.handLevel);
        
        const newTeam = new Team({
          tournamentId: tournamentId || "default",
          teamCode: teamCode,
          teamName: item.teamName,
          handLevel: item.handLevel,
          // ถ้ามีผู้เล่นมากกว่า 1 คน ถือเป็นคู่ (Doubles)
          competitionType: playerIds.length > 1 ? "Doubles" : "Singles",
          players: playerIds,
          manualRank: 0
        });

        const savedTeam = await newTeam.save();
        results.push(savedTeam);

      } catch (innerErr) {
        console.error("Error importing team:", item.teamName, innerErr);
        errors.push({ team: item.teamName, error: innerErr.message });
      }
    }

    res.json({ 
      success: true, 
      importedCount: results.length, 
      errorCount: errors.length,
      errors: errors 
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// GET List Teams
router.get("/", async (req, res) => {
  try {
    const { tournamentId, handLevel, competitionType } = req.query;
    const query = {};

    if (tournamentId) query.tournamentId = tournamentId;

    if (handLevel && handLevel !== "ALL") {
      query.handLevel = handLevel;
    }
    if (competitionType) {
      query.competitionType = competitionType;
    }

    const teams = await Team.find(query)
      .populate("players")
      .sort({ teamName: 1 });

    res.json(teams);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/update-ranks", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { updates } = req.body;
    if (!Array.isArray(updates))
      return res.status(400).json({ message: "Invalid data" });
    const promises = updates.map((u) =>
      Team.findByIdAndUpdate(u.teamId, {
        manualRank: Number(u.manualRank) || 0,
      })
    );
    await Promise.all(promises);
    res.json({ message: "Updated ranks successfully" });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const team = await Team.findById(req.params.id).populate("players");
    if (!team) return res.status(404).json({ message: "Team not found" });
    res.json(team);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// List by HandLevel
router.get("/byHand/:handLevel", async (req, res) => {
  try {
    const { tournamentId } = req.query;
    const query = { handLevel: req.params.handLevel };

    if (tournamentId) query.tournamentId = tournamentId;

    const teams = await Team.find(query).populate("players").sort({ teamName: 1 });
    res.json(teams);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

function generateTeamCode(handLevel) {
  const prefix = (handLevel || "XX")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 3)
    .toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `TM-${prefix}-${suffix}`;
}

// Create Team
router.post("/", authMiddleware, requireAdmin, async (req, res) => {
  const {
    tournamentId,
    teamName,
    competitionType,
    handLevel,
    players,
    managerName,
    phone,
    lineId,
  } = req.body;

  try {
    const finalTeamCode = generateTeamCode(handLevel);

    const newTeam = new Team({
      tournamentId: tournamentId || "default",
      teamCode: finalTeamCode,
      teamName,
      competitionType,
      handLevel,
      players,
      managerName,
      phone,
      lineId,
    });

    const savedTeam = await newTeam.save();
    await savedTeam.populate("players");

    res.status(201).json(savedTeam);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put("/:id", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const updatedTeam = await Team.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).populate("players");
    if (!updatedTeam) return res.status(404).json({ message: "Team not found" });
    res.json(updatedTeam);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete("/:id", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const deletedTeam = await Team.findByIdAndDelete(req.params.id);
    if (!deletedTeam) return res.status(404).json({ message: "Team not found" });
    res.json({ message: "Team deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;