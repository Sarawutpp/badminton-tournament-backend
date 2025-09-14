// src/app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./db');


const app = express();

// --- START: แก้ไขส่วน CORS ---
// สำหรับการทดสอบ ให้เปิดรับทุก Origin ชั่วคราว
// เพื่อตรวจสอบว่าปัญหาอยู่ที่การตั้งค่า Whitelist หรือไม่
console.log('CORS is configured to allow all origins for debugging.');
app.use(cors());
// --- END: แก้ไขส่วน CORS ---


app.use(express.json());


// ===== Health =====
app.get('/api/health', (_req, res) => res.json({ ok: true }));


// ===== Routes =====
app.use('/api/teams', require('./routes/team.routes'));
app.use('/api/matches', require('./routes/match.routes'));
app.use('/api/tournaments', require('./routes/tournament.routes'));


// ===== DB Connect =====
(async () => {
try {
const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/badtournament';
await connectDB(uri);
console.log('MongoDB connected');
} catch (err) {
console.error('DB connection error:', err);
}
})();


module.exports = app;

