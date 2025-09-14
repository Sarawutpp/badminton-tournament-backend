// server.js
require('dotenv').config();
const { createServer } = require('http');
const app = require('./src/app');

// เปลี่ยน Port จาก 5000 เป็น 5001 เพื่อหลีกเลี่ยงการชนกัน
const PORT = process.env.PORT || 5001; 
const server = createServer(app);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`API running on http://0.0.0.0:${PORT}`);
});

