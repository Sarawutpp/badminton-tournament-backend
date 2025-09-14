// server.js
require('dotenv').config();
const { createServer } = require('http');
const app = require('./src/app');


const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0'; // <-- เพิ่มบรรทัดนี้: เพื่อให้ Server รับการเชื่อมต่อจากภายนอก
const server = createServer(app);


// แก้ไขบรรทัดนี้: เพิ่ม HOST เข้าไป
server.listen(PORT, HOST, () => {
  console.log(`API running on http://${HOST}:${PORT}`);
});// deploy-test Sat 09/06/2025 14:34:30.23
