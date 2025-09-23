// app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./db');

const app = express();

// ---------- CORS (แก้ใหม่) ----------
/**
 * อนุญาตเฉพาะ origin ที่กำหนด เพื่อให้ใช้คู่กับ credentials ได้
 * - ตั้งค่าเพิ่มเติมผ่าน ENV ได้: ALLOW_ORIGINS="http://localhost:5173,https://your-frontend.example"
 */
const allowedOrigins = (process.env.ALLOW_ORIGINS
  ? process.env.ALLOW_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://119.59.102.134'
    ]
);

// ให้ cache เคารพ Origin ต่างกัน
app.use((req, res, next) => {
  res.header('Vary', 'Origin');
  next();
});

// ถ้าอยู่หลัง Nginx/Proxy และใช้คุกกี้ ควรเปิด trust proxy
// app.set('trust proxy', 1);

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);            // อนุญาตคำขอที่ไม่มี Origin (เช่น curl/health)
    cb(null, allowedOrigins.includes(origin));
  },
  credentials: true,                               // สำคัญ: รองรับ cookies / auth
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
// ---------- จบ CORS ----------

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
    const uri =
      process.env.MONGODB_URI ||
      process.env.MONGO_URI ||
      'mongodb://127.0.0.1:27017/badtournament';
    await connectDB(uri);
    console.log('MongoDB connected');
  } catch (err) {
    console.error('DB connection error:', err);
  }
})();

module.exports = app;
