const mongoose = require('mongoose');
const { Schema } = mongoose;


const teamSchema = new Schema(
{
teamCode: { type: String, unique: true, index: true },
competitionType: { type: String, enum: ['Singles', 'Doubles'], required: true },
handLevel: { type: String, required: true }, // เก็บโค้ดมือแบบย่อ เช่น N / NB / Baby / BG- / Mix


players: [{ type: Schema.Types.ObjectId, ref: 'Player', required: true }],


managerName: { type: String },
phone: { type: String },
lineId: { type: String },


// ฟิลด์เก่าที่ใช้ในตารางคะแนน (เก็บไว้ตามระบบเดิม)
matchesPlayed: { type: Number, default: 0 },
wins: { type: Number, default: 0 },
losses: { type: Number, default: 0 },
points: { type: Number, default: 0 },
scoreDifference: { type: Number, default: 0 },
},
{ timestamps: true }
);


module.exports = mongoose.model('Team', teamSchema);