// app.js
const app = express();

// ---------- CORS ----------
const allowedOrigins = process.env.ALLOW_ORIGINS
  ? process.env.ALLOW_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : ["http://localhost:5173", "http://127.0.0.1:5173", "http://119.59.102.134"];

app.use((req, res, next) => {
  res.header("Vary", "Origin");
  next();
});

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    cb(null, allowedOrigins.includes(origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
// ---------- END CORS ----------

app.use(express.json());

// ===== Health =====
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ===== Routes =====
app.use("/api/teams", require("./routes/team.routes"));
app.use("/api/matches", require("./routes/match.routes"));
app.use("/api/tournaments", require("./routes/tournament.routes"));
app.use("/api/players", require("./routes/player.routes"));

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
