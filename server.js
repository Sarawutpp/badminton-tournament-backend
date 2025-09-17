const app = require('./src/app');

// เปลี่ยน Port เริ่มต้น (Default) ให้เป็น 5000
// ระบบจะพยายามหาค่า PORT จากไฟล์ .env ก่อน ถ้าไม่เจอถึงจะใช้ 5000
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});