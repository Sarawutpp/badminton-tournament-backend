// routes/auth.routes.js
const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");

const router = express.Router();

// ---------- config ----------
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

function getCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd, // ต้องใช้ HTTPS ใน prod
    path: "/",
  };
}

// ---------- helpers ----------
function signToken(user) {
  const payload = {
    sub: user._id.toString(),
    username: user.username,
    role: user.role,
    displayName: user.displayName,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

// ---------- Middlewares ----------
async function authMiddleware(req, res, next) {
  const token = req.cookies ? req.cookies.token : null;

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // สามารถเลือกเช็คใน DB เพิ่มได้ ถ้าอยากเช็ค isActive ทุกครั้ง
    const user = await User.findById(decoded.sub).lean();
    if (!user || !user.isActive) {
      res.clearCookie("token", getCookieOptions());
      req.user = null;
      return next();
    }

    req.user = {
      id: user._id.toString(),
      username: user.username,
      role: user.role,
      displayName: user.displayName,
    };
    next();
  } catch (err) {
    // token เสีย / หมดอายุ → เคลียร์ cookie ทิ้ง
    res.clearCookie("token", getCookieOptions());
    req.user = null;
    next();
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: "ต้อง Login ก่อนเข้าหน้านี้" });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: "ต้อง Login ก่อนเข้าหน้านี้" });
  }
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "ไม่มีสิทธิ์เข้าหน้านี้ (ต้องเป็น admin)" });
  }
  next();
}

// ---------- Routes ----------

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ message: "username และ password จำเป็นต้องกรอก" });
    }

    const normalizedUsername = String(username).trim().toLowerCase();
    const user = await User.findOne({ username: normalizedUsername });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
    }

    const ok = await user.comparePassword(password);
    if (!ok) {
      return res.status(401).json({ message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
    }

    const token = signToken(user);

    res.cookie("token", token, getCookieOptions());

    return res.json({
      user: {
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ" });
  }
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  res.clearCookie("token", getCookieOptions());
  res.json({ message: "Logged out" });
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req, res) => {
  // ที่ authMiddleware ใส่ req.user ไว้แล้ว
  return res.json({
    user: {
      username: req.user.username,
      displayName: req.user.displayName,
      role: req.user.role,
    },
  });
});

// export router + middlewares
module.exports = {
  authRouter: router,
  authMiddleware,
  requireAuth,
  requireAdmin,
};
