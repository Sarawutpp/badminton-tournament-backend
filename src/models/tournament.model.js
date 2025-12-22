// models/tournament.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const tournamentSchema = new Schema({
  name: { type: String, required: true },
  location: { type: String },
  dateRange: { type: String },
  
  // Field นี้อาจจะไม่ได้ใช้แล้วถ้าใช้ settings.categories แทน แต่เก็บไว้กันเหนียวได้
  levels: [{ type: String }], 

  // --- ส่วนที่ปรับปรุง: การตั้งค่าที่ละเอียดขึ้น ---
  settings: {
    totalCourts: { type: Number, default: 4 },
    categories: [{ type: String }], // รุ่นการแข่งขัน เช่น ['Baby', 'P', 'S']
    
    // Config การแบ่งสาย (สำคัญสำหรับแยกว่า 16 ทีม หรือ 24 ทีม)
    qualificationType: { 
        type: String, 
        default: "TOP2_UPPER_REST_LOWER", // หรือ "TOP2_PLUS_4BEST_3RD"
        enum: ["TOP2_UPPER_REST_LOWER", "TOP2_PLUS_4BEST_3RD", "STANDARD"]
    },

    // Config กติกาการแข่ง (แยกตามรอบ)
    matchConfig: {
        // รอบแบ่งกลุ่ม (Mini เล่น 1 เกม, Standard เล่น 2 ใน 3)
        groupStage: {
            gamesToWin: { type: Number, default: 2 }, // ปกติ 2, Mini = 1
            maxScore: { type: Number, default: 21 },
            hasDeuce: { type: Boolean, default: true }, // Mini = false
            deuceCap: { type: Number, default: 30 }
        },
        // รอบ Knockout (ส่วนใหญ่จะเล่นเต็มรูปแบบเสมอ)
        knockoutStage: {
            gamesToWin: { type: Number, default: 2 },
            maxScore: { type: Number, default: 21 },
            hasDeuce: { type: Boolean, default: true },
            deuceCap: { type: Number, default: 30 }
        }
    }
  },

  // กติกาการให้คะแนนในตาราง (Points)
  rules: {
    // ✅ [CHANGE] แก้ Default เป็น 3 คะแนน (Root Cause Fix)
    pointsWin: { type: Number, default: 3 },  
    pointsLose: { type: Number, default: 0 },
    pointsDraw: { type: Number, default: 1 }
  },
  
  status: { 
    type: String, 
    enum: ['active', 'finished', 'archived'], 
    default: 'active' 
  }
}, { timestamps: true });

module.exports = mongoose.model('Tournament', tournamentSchema);