const express = require("express");
const router = express.Router();
const Team = require("../models/team.model"); // ✅ แก้ Path
const Player = require("../models/player.model"); // ✅ แก้ Path

// GET / (List Teams)
router.get("/", async (req, res) => {
  try {
    const query = {};

    // --- [START] ✅ แก้ไข Bug Logic ---
    if (req.query.handLevel && req.query.handLevel !== "ALL") {
      query.handLevel = req.query.handLevel;
    }
    // --- [END] ✅ แก้ไข Bug Logic ---

    if (req.query.competitionType) {
      query.competitionType = req.query.competitionType;
    }

    const teams = await Team.find(query)
      .populate("players")
      .sort({ teamName: 1 });
      
    res.json(teams);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/update-ranks", async (req, res) => {
  try {
    // รับ body เป็น array: [{ teamId: "...", manualRank: 1 }, ...]
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

// GET /:id (Get Team by ID)
router.get("/:id", async (req, res) => {
  try {
    const team = await Team.findById(req.params.id).populate("players");
    if (!team) return res.status(404).json({ message: "Team not found" });
    res.json(team);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /byHand/:handLevel (List by HandLevel)
router.get("/byHand/:handLevel", async (req, res) => {
  try {
    const teams = await Team.find({ handLevel: req.params.handLevel })
      .populate("players")
      .sort({ teamName: 1 });
    res.json(teams);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST / (Create Team)
router.post("/", async (req, res) => {
  const {
    teamCode,
    teamName,
    competitionType,
    handLevel,
    players,
    managerName,
    phone,
    lineId,
  } = req.body;

  try {
    if (players && players.length > 0) {
      const foundPlayers = await Player.find({ _id: { $in: players } });
      if (foundPlayers.length !== players.length) {
        return res.status(400).json({ message: "Some players not found" });
      }
    }

    const newTeam = new Team({
      teamCode,
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

// PUT /:id (Update Team)
router.put("/:id", async (req, res) => {
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

// DELETE /:id (Delete Team)
router.delete("/:id", async (req, res) => {
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