const mongoose = require('mongoose');
const { Schema } = mongoose;


const playerSchema = new Schema(
{
playerCode: { type: String, unique: true, index: true }, // ใช้เป็นรหัสอ้างอิงสั้น ๆ
fullName: { type: String, required: true },
nickname: { type: String },
age: { type: Number }, // อิงจากไฟล์ Excel รอบนี้ (ถ้าต้องการใช้ birthYear ให้สลับเอง)
lastCompetition: { type: String },
photoUrl: { type: String },
},
{ timestamps: true }
);


module.exports = mongoose.model('Player', playerSchema);