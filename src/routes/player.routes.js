const express = require("express");
const router = express.Router();
const Player = require("../models/player.model"); // ✅ แก้ Path

// GET / (List Players)
router.get("/", async (req, res) => {
  try {
    const players = await Player.find().sort({ fullName: 1 });
    res.json(players);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /:id (Get Player by ID)
router.get("/:id", async (req, res) => {
  try {
    const player = await Player.findById(req.params.id);
    if (!player) return res.status(404).json({ message: "Player not found" });
    res.json(player);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST / (Create Player)
router.post("/", async (req, res) => {
  const { playerCode, fullName, nickname, age, lastCompetition, photoUrl } =
    req.body;

  if (!fullName) {
    return res.status(400).json({ message: "Full name is required" });
  }

  try {
    const newPlayer = new Player({
      playerCode,
      fullName,
      nickname,
      age,
      lastCompetition,
      photoUrl,
    });

    const savedPlayer = await newPlayer.save();
    res.status(201).json(savedPlayer);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /:id (Update Player)
router.put("/:id", async (req, res) => {
  try {
    const updatedPlayer = await Player.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!updatedPlayer)
      return res.status(404).json({ message: "Player not found" });
    res.json(updatedPlayer);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /:id (Delete Player)
router.delete("/:id", async (req, res) => {
  try {
    const deletedPlayer = await Player.findByIdAndDelete(req.params.id);
    if (!deletedPlayer)
      return res.status(404).json({ message: "Player not found" });
    res.json({ message: "Player deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;