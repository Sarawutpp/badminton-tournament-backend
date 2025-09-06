// src/models/team.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;


const teamSchema = new Schema({
teamName: { type: String, required: true, unique: true },
handLevel: { type: String, required: true },
group: { type: String }, // 'A','B', ...


// ✅ เพิ่ม teamCode และจัดการ index ให้ไม่ชนตอนเป็น null
// ใช้ unique+sparse (หรือ partial index ก็ได้ — ดูคอมเมนต์ด้านล่าง)
teamCode: { type: String, unique: true, sparse: true },
// ถ้าอยากใช้ partial index (ชัดกว่า) ให้คอมเมนต์บรรทัดบน แล้วใช้โค้ดสร้าง index ใน Mongo:
// db.teams.createIndex({ teamCode: 1 }, { unique: true, partialFilterExpression: { teamCode: { $type: 'string' } } })


players: [{ type: Schema.Types.ObjectId, ref: 'Player', required: true }],


managerName: { type: String },
tel: { type: String },
lineId: { type: String },


// รอบแบ่งกลุ่ม (สถิติ)
matchesPlayed: { type: Number, default: 0 },
wins: { type: Number, default: 0 },
losses: { type: Number, default: 0 },
points: { type: Number, default: 0 }, // ชนะ 2 แพ้ 1
scoreDifference: { type: Number, default: 0 }
}, { timestamps: true });


module.exports = mongoose.model('Team', teamSchema);