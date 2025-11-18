// app.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { connectDB } = require("./db");

const {
  authRouter,
  authMiddleware,
  requireAdmin,
} = require("./routes/auth.routes");

const app = express();

// ---------- CORS ----------
/**
 * อนุญาตเฉพาะ origin ที่กำหนด เพื่อให้ใช้คู่กับ credentials ได้
 * ปรับเพิ่ม/ลดได้ผ่าน .env: ALLOW_ORIGINS="http://localhost:5173,https://your-frontend.example"
 */
const allowedOrigins = (process.env.ALLOW_ORIGINS
  ? process.env.ALLOW_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://119.59.102.134",
    ]);

// ให้ cache เคารพ Origin ต่างกัน
app.use((req, res, next) => {
  res.header("Vary", "Origin");
  next();
});

// ถ้าอยู่หลัง Nginx/Proxy และมี cookie ให้เปิด trust proxy ได้
// app.set('trust proxy', 1);

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // อนุญาตพวก curl / health-check
    cb(null, allowedOrigins.includes(origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
// ---------- จบ CORS ----------

app.use(express.json());
app.use(cookieParser());

// ---------- Auth Middleware แบบ Global ----------
app.use(authMiddleware);

// ===== Health =====
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ===== Auth Routes =====
app.use("/api/auth", authRouter);

// ===== Sample Protected Admin Route (ตัวอย่าง) =====
const adminRouter = express.Router();

// /api/admin/health → ต้องเป็น admin เท่านั้น
adminRouter.get("/health", requireAdmin, (req, res) => {
  res.json({
    ok: true,
    message: "Admin zone only",
    user: req.user,
  });
});

app.use("/api/admin", adminRouter);

// ===== Business Routes เดิม =====
app.use("/api/players", require("./routes/player.routes"));
app.use("/api/teams", require("./routes/team.routes"));
app.use("/api/matches", require("./routes/match.routes"));
app.use("/api/tournaments", require("./routes/tournament.routes"));
app.use("/api/standings", require("./routes/standings.routes")); // ✅ เพิ่มบรรทัดนี้ไว้แล้วเดิม

// ===== DB Connect =====
(async () => {
  try {
    const uri =
      process.env.MONGODB_URI ||
      process.env.MONGO_URI ||
      "mongodb://127.0.0.1:27017/badtournament";
    await connectDB(uri);
    console.log("MongoDB connected");
  } catch (err) {
    console.error("DB connection error:", err);
  }
})();

module.exports = app;
