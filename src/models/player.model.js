// models/player.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const playerSchema = new Schema(
  {
    // [NEW] ผูกผู้เล่นกับทัวร์นาเมนต์
    tournamentId: {
        type: Schema.Types.ObjectId,
        ref: "Tournament",
        required: true, // บังคับว่าผู้เล่นต้องสังกัดงานใดงานหนึ่ง
        index: true
    },

    playerCode: { type: String, index: true }, // อาจจะไม่ unique globally แล้ว ถ้าใช้ code เดิมซ้ำในงานใหม่
    fullName: { type: String, required: true, trim: true },
    nickname: { type: String, trim: true },
    age: { type: Number },
    lastCompetition: { type: String },
    photoUrl: { type: String },
  },
  { timestamps: true }
);

// Optional: Composite Index เพื่อป้องกันชื่อซ้ำในทัวร์นาเมนต์เดียวกัน
playerSchema.index({ tournamentId: 1, fullName: 1 });

module.exports = mongoose.model('Player', playerSchema);
