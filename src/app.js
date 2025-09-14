// src/app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./db');


const app = express();

// --- START: แก้ไขส่วน CORS ---
// กำหนด URL ของ Frontend ที่คุณอนุญาต
const allowedOrigins = [
  'http://localhost:3000', // สำหรับตอนพัฒนาบนเครื่อง
  'http://localhost:5173', // *** เพิ่ม Port ที่ใช้งานจริงเข้าไป ***
  // *** ใส่ URL ของ Frontend ที่ deploy แล้วของคุณตรงนี้ ***
  // เช่น 'https://your-domain.com'
];

const corsOptions = {
  origin: function (origin, callback) {
    // อนุญาตถ้า origin อยู่ใน list ที่เรากำหนด หรือในกรณีที่ origin เป็น undefined (เช่น เรียกจาก Postman)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
};

// ใช้ cors middleware พร้อมกับ options ที่กำหนด
app.use(cors(corsOptions));
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

