// routes/team.routes.js
const express = require("express");
const router = express.Router();
const Team = require("../models/team.model");
const Player = require("../models/player.model");
const { authMiddleware, requireAdmin } = require("./auth.routes");

// GET List Teams
router.get("/", async (req, res) => {
  try {
    const { tournamentId, handLevel, competitionType } = req.query;
    const query = {};

    // [Phase 2] Filter by Tournament ID
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
    if (!Array.isArray(updates)) return res.status(400).json({ message: "Invalid data" });
    const promises = updates.map(u => 
      Team.findByIdAndUpdate(u.teamId, { manualRank: Number(u.manualRank) || 0 })
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
    
    // [Phase 2] Filter by Tournament ID
    if(tournamentId) query.tournamentId = tournamentId;

    const teams = await Team.find(query)
      .populate("players")
      .sort({ teamName: 1 });
    res.json(teams);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

function generateTeamCode(handLevel) {
  const prefix = (handLevel || "XX").replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `TM-${prefix}-${suffix}`;
}
// Create Team
router.post("/", authMiddleware, requireAdmin, async (req, res) => {
  const {
    tournamentId,
    // teamCode, <-- ❌ ไม่รับจาก Frontend แล้ว
    teamName,
    competitionType,
    handLevel,
    players,
    managerName,
    phone,
    lineId,
  } = req.body;

  try {
    // ✅ สร้างรหัสอัตโนมัติจาก handLevel ทันที
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
    if (!updatedTeam)
      return res.status(404).json({ message: "Team not found" });
    res.json(updatedTeam);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete("/:id", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const deletedTeam = await Team.findByIdAndDelete(req.params.id);
    if (!deletedTeam)
      return res.status(404).json({ message: "Team not found" });
    res.json({ message: "Team deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;