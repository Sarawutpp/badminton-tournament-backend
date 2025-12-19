// routes/player.routes.js
const express = require("express");
const router = express.Router();
const Player = require("../models/player.model");


const genCode = (prefix) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
// GET Players
router.get("/", async (req, res) => {
  try {
    const { tournamentId } = req.query;
    const query = {};

    // [Phase 2] Filter by Tournament ID
    if (tournamentId) query.tournamentId = tournamentId;

    const players = await Player.find(query).sort({ fullName: 1 });
    res.json(players);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const player = await Player.findById(req.params.id);
    if (!player) return res.status(404).json({ message: "Player not found" });
    res.json(player);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/", async (req, res) => {
  const { tournamentId, fullName, nickname, age, lastCompetition, photoUrl } = req.body;

  if (!fullName) return res.status(400).json({ message: "Full name is required" });

  try {
    const newPlayer = new Player({
      tournamentId: tournamentId || "default",
      playerCode: genCode("PL"), // ✅ Auto Gen เสมอ
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
router.post("/import", async (req, res) => {
  const { tournamentId, players } = req.body; // players = [{ fullName, nickname, age }, ...]

  if (!Array.isArray(players) || players.length === 0) {
    return res.status(400).json({ message: "Invalid data" });
  }

  try {
    const docs = players.map(p => ({
      tournamentId: tournamentId || "default",
      playerCode: genCode("PL"), // ✅ Gen ให้ทุกคน
      fullName: p.fullName,
      nickname: p.nickname || "",
      age: p.age ? Number(p.age) : undefined,
      lastCompetition: p.lastCompetition || ""
    }));

    // ใช้ insertMany เพื่อความเร็ว
    const saved = await Player.insertMany(docs);
    res.status(201).json({ message: "Import success", count: saved.length, items: saved });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const updatedPlayer = await Player.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!updatedPlayer) return res.status(404).json({ message: "Player not found" });
    res.json(updatedPlayer);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const deletedPlayer = await Player.findByIdAndDelete(req.params.id);
    if (!deletedPlayer) return res.status(404).json({ message: "Player not found" });
    res.json({ message: "Player deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;