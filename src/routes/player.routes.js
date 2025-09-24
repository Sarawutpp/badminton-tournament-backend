const router = require("express").Router();
const Player = require("../models/player.model");

// CREATE player
router.post("/", async (req, res, next) => {
  try {
    const { fullName, nickname, birthYear, shirtSize, lastCompetition } =
      req.body;
    const player = await Player.create({
      fullName,
      nickname,
      birthYear,
      shirtSize,
      lastCompetition,
    });
    res.status(201).json(player);
  } catch (err) {
    next(err);
  }
});

// LIST all players
router.get("/", async (_req, res, next) => {
  try {
    const players = await Player.find().sort({ createdAt: -1 });
    res.json(players);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
